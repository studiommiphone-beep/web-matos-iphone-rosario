// ============================================================
// api/mp-webhook.js — Mercado Pago avisa acá cuando cambia un pago.
//
// Si el pago quedó APROBADO:
//   1) descuenta el stock en el catálogo (y lo pasa a "Sin stock" si llega a 0)
//   2) registra la venta en tu panel de ventas (pestaña Ventas del admin)
// Cada pago se procesa una sola vez aunque Mercado Pago avise varias veces.
//
// 🔒 Nunca confía en lo que llega en el aviso: con el ID consulta el pago
//    directamente a Mercado Pago usando tu Access Token.
//
// Variables de entorno en Vercel:
//   MP_ACCESS_TOKEN    -> el mismo de api/pago.js
//   MP_WEBHOOK_SECRET  -> (recomendado) "Clave secreta" de Webhooks en tu app de MP
// ============================================================
const crypto = require('crypto');
const { leerCatalogo, guardarCatalogo, leerVentas, guardarVentas, estadoDisp } = require('./_tienda');

// Medio de pago de MP -> medio de pago de tu panel de ventas
const METODO_PANEL = {
  credit_card: 'credito',
  debit_card: 'debito',
  prepaid_card: 'debito',
  account_money: 'transferencia',
  bank_transfer: 'transferencia',
  ticket: 'efectivo',
  atm: 'efectivo'
};

function firmaValida(req, dataId) {
  const secreto = process.env.MP_WEBHOOK_SECRET;
  if (!secreto) return true; // sin clave configurada no se valida (igual se consulta el pago a MP)
  const firma = String(req.headers['x-signature'] || '');
  const requestId = String(req.headers['x-request-id'] || '');
  const partes = Object.fromEntries(firma.split(',').map(p => p.trim().split('=')));
  if (!partes.ts || !partes.v1) return false;
  const idManifest = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  let manifest = '';
  if (idManifest) manifest += `id:${idManifest};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${partes.ts};`;
  const esperado = crypto.createHmac('sha256', secreto).update(manifest).digest('hex');
  const a = Buffer.from(esperado), b = Buffer.from(String(partes.v1));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  // Mercado Pago solo necesita un 200 rápido; si algo falla devolvemos 500 y reintenta.
  if (req.method !== 'POST') return res.status(200).json({ ok: true });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const q = req.query || {};
  const tipo = q.type || q.topic || body.type || body.topic;
  const dataId = String(q['data.id'] || (body.data && body.data.id) || q.id || '');

  if (tipo !== 'payment' || !dataId) return res.status(200).json({ ignorado: true });
  if (!firmaValida(req, dataId)) return res.status(401).json({ error: 'Firma inválida' });

  try {
    const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(dataId)}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
    });
    const pago = await r.json();
    if (!r.ok) throw new Error(`MP respondió ${r.status} al consultar el pago ${dataId}`);
    if (pago.status !== 'approved') return res.status(200).json({ estado: pago.status });

    const datosVentas = await leerVentas();
    if (datosVentas.ventas.some(v => String(v.mpPaymentId) === String(pago.id))) {
      return res.status(200).json({ yaProcesado: true });
    }

    const catalogo = await leerCatalogo();
    const pedido = (pago.metadata && pago.metadata.pedido) || [];
    const totalARS = Number(pago.transaction_amount) || 0;
    const netoARS = Number(pago.transaction_details && pago.transaction_details.net_received_amount) || totalARS;
    const comisionPct = totalARS ? Math.round((1 - netoARS / totalARS) * 10000) / 100 : 0;
    const comprador = pago.payer || {};
    const nombreComprador = [comprador.first_name, comprador.last_name].filter(Boolean).join(' ') || comprador.email || 'Cliente Mercado Pago';
    const telefono = comprador.phone && comprador.phone.number ? `${comprador.phone.area_code || ''}${comprador.phone.number}` : '';
    const metodo = METODO_PANEL[pago.payment_type_id] || 'transferencia';
    const cuotas = metodo === 'credito' ? (Number(pago.installments) || 1) : 0;
    let nro = datosVentas.ventas.reduce((mx, v) => Math.max(mx, v.nro || 0), 0);
    let catalogoCambio = false;
    const hoy = new Date(pago.date_approved || Date.now()).toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });

    for (const linea of pedido) {
      const prod = (catalogo || []).find(p => String(p.id) === String(linea.id));
      const cantidad = Number(linea.c) || 1;
      const cot = Number(linea.cot) || 0;
      const precioUSD = Number(linea.usd) || (prod ? Number(prod.precioDirectoUSD) : 0);
      const brutoUSD = precioUSD * cantidad;
      const netoUSD = brutoUSD * (1 - comisionPct / 100);
      const costoTotalUSD = prod ? (Number(prod.costoBaseUSD) || 0) * cantidad : 0;

      let descontado = 0;
      if (prod && estadoDisp(prod) === 'En Stock') {
        descontado = Math.min(cantidad, Number(prod.stock) || 0);
        prod.stock = Math.max(0, (Number(prod.stock) || 0) - cantidad);
        if (prod.stock === 0) prod.disponibilidad = 'Sin stock';
        catalogoCambio = true;
      }

      datosVentas.ventas.push({
        id: `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        creada: Date.now(), fecha: hoy, origen: 'catalogo', productoId: prod ? prod.id : linea.id,
        nombre: prod ? prod.nombre : `Producto ${linea.id}`, specs: prod ? (prod.specs || '') : '', imei: prod ? (prod.imei || '') : '',
        cantidad, proveedorId: '', proveedorNombre: '',
        cliente: nombreComprador, telefono,
        notas: `Pago web Mercado Pago #${pago.id} · ${pago.external_reference || ''} · ${comprador.email || ''}${prod && estadoDisp(prod) === 'A pedido' ? ' · ⚠️ EQUIPO A PEDIDO: encargar al proveedor' : ''}`,
        precioUSD, costoUSD: prod ? Number(prod.costoBaseUSD) || 0 : 0, gastosUSD: 0, cot,
        metodo, cuotas, recargoPct: 0, comisionPct,
        cripto: null,
        brutoUSD, brutoARS: brutoUSD * cot, netoUSD, costoTotalUSD,
        gananciaUSD: netoUSD - costoTotalUSD, valorCuotaARS: cuotas ? (brutoUSD * cot) / cuotas : 0,
        condicion: prod ? (prod.condicion || '') : '', bateria: prod ? (prod.bateria || '') : '', garantia: prod ? (prod.garantia || '') : '',
        nro: ++nro, descontoStock: descontado, financiado: null,
        mercadoPago: true, mpPaymentId: pago.id, mpReferencia: pago.external_reference || ''
      });
    }

    // Primero la venta (marca el pago como procesado), después el stock
    await guardarVentas(datosVentas);
    if (catalogoCambio) await guardarCatalogo(catalogo);
    return res.status(200).json({ ok: true, ventas: pedido.length });
  } catch (error) {
    console.error('Error procesando webhook MP:', error);
    return res.status(500).json({ error: error.message });
  }
};
