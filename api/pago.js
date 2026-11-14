// ============================================================
// api/pago.js — Crea el pago de Mercado Pago (Checkout Pro)
//
// GET  -> { activo: true/false }  (la tienda muestra el botón solo si está configurado)
// POST -> body { items: [{ id, cantidad }] }
//         Devuelve { url } para mandar al cliente a pagar.
//
// 🔒 El precio NUNCA viene del navegador: se toma del catálogo guardado
//    y se pasa a pesos con el dólar del día, acá en el servidor.
//
// Variables de entorno en Vercel:
//   MP_ACCESS_TOKEN  -> Access Token de PRODUCCIÓN de tu aplicación de Mercado Pago
//   MP_RECARGO_PCT   -> (opcional) % que se suma al pagar con MP, ej. 0 o 6
//   MP_MAX_CUOTAS    -> (opcional) máximo de cuotas a ofrecer, por defecto 18
//   SITE_URL         -> (opcional) https://matosiphonesrosario.com.ar
// ============================================================
const { leerCatalogo, cotizaciones, cotizacionDe, estadoDisp, sitioURL } = require('./_tienda');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const token = process.env.MP_ACCESS_TOKEN;

  if (req.method === 'GET') return res.status(200).json({ activo: Boolean(token) });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!token) return res.status(503).json({ error: 'El pago online todavía no está habilitado. Escribinos por WhatsApp.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const pedidos = Array.isArray(body.items) ? body.items.slice(0, 10) : [];
    if (!pedidos.length) return res.status(400).json({ error: 'El carrito está vacío.' });

    const [catalogo, cot] = await Promise.all([leerCatalogo(), cotizaciones()]);
    const recargo = 1 + (Number(process.env.MP_RECARGO_PCT) || 0) / 100;
    const base = sitioURL(req);
    const items = [];
    const detalle = [];

    for (const ped of pedidos) {
      const prod = (catalogo || []).find(p => String(p.id) === String(ped.id));
      const cantidad = Math.max(1, Math.min(10, parseInt(ped.cantidad, 10) || 1));
      if (!prod) return res.status(409).json({ error: 'Uno de los equipos ya no está en el catálogo. Actualizá la página.' });
      const estado = estadoDisp(prod);
      if (estado === 'Sin stock') return res.status(409).json({ error: `${prod.nombre} (${prod.specs || ''}) se acaba de vender. Actualizá la página.`.replace(" ()", "") });
      if (estado === 'En Stock' && cantidad > Number(prod.stock)) {
        return res.status(409).json({ error: `De ${prod.nombre} quedan ${prod.stock} unidad(es).` });
      }
      const dolar = cotizacionDe(prod, cot);
      if (!(dolar > 0)) return res.status(503).json({ error: 'No pudimos obtener la cotización del dólar. Probá en unos minutos.' });
      const precioARS = Math.round(Number(prod.precioDirectoUSD) * dolar * recargo);
      if (!(precioARS > 0)) return res.status(409).json({ error: `${prod.nombre} no tiene precio cargado.` });

      const foto = prod.imagenes && prod.imagenes[0];
      items.push({
        id: String(prod.id),
        title: `${prod.nombre} ${prod.specs ? '· ' + prod.specs : ''}`.slice(0, 250),
        description: estado === 'A pedido' ? 'Equipo a pedido' : (prod.condicion || ''),
        picture_url: foto ? (foto.startsWith('http') ? foto : `${base}/${foto.replace(/^\//, '')}`) : undefined,
        category_id: 'phones',
        quantity: cantidad,
        currency_id: 'ARS',
        unit_price: precioARS
      });
      detalle.push({ id: prod.id, c: cantidad, usd: Number(prod.precioDirectoUSD), cot: dolar });
    }

    const referencia = `MATOS-${Date.now().toString(36).toUpperCase()}`;
    const vence = new Date(Date.now() + 2 * 60 * 60 * 1000); // el precio en pesos vale 2 horas

    const preferencia = {
      items,
      external_reference: referencia,
      metadata: { pedido: detalle, referencia },
      back_urls: {
        success: `${base}/?pago=aprobado`,
        pending: `${base}/?pago=pendiente`,
        failure: `${base}/?pago=rechazado`
      },
      auto_return: 'approved',
      notification_url: `${base}/api/mp-webhook`,
      statement_descriptor: 'MATOS IPHONE',
      payment_methods: { installments: Number(process.env.MP_MAX_CUOTAS) || 18 },
      expires: true,
      expiration_date_to: vence.toISOString()
    };

    const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Idempotency-Key': referencia },
      body: JSON.stringify(preferencia)
    });
    const data = await r.json();
    if (!r.ok) {
      console.error('Mercado Pago rechazó la preferencia:', data);
      return res.status(502).json({ error: 'Mercado Pago no respondió bien. Probá de nuevo o escribinos por WhatsApp.' });
    }
    return res.status(200).json({ url: data.init_point, referencia });
  } catch (error) {
    console.error('Error creando pago:', error);
    return res.status(500).json({ error: 'No pudimos iniciar el pago. Probá de nuevo o escribinos por WhatsApp.' });
  }
};
