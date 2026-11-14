// ============================================================
// api/_tienda.js — Ayudante compartido (no es un endpoint: empieza con _)
// Lee/guarda catálogo y ventas en JSONBin, trae la cotización del dólar
// y calcula el precio en pesos SIEMPRE del lado del servidor.
// ============================================================

const JSONBIN = 'https://api.jsonbin.io/v3/b/';

function headersBin() {
  return { 'Content-Type': 'application/json', 'X-Master-Key': process.env.JSONBIN_KEY };
}

async function leerBin(binId) {
  const r = await fetch(`${JSONBIN}${binId}/latest`, { headers: headersBin(), cache: 'no-store' });
  const data = await r.json();
  if (!r.ok) throw new Error(`JSONBin (${r.status}): ${data.message || 'error al leer'}`);
  return data.record !== undefined ? data.record : data;
}

async function guardarBin(binId, contenido) {
  const r = await fetch(`${JSONBIN}${binId}`, { method: 'PUT', headers: headersBin(), body: JSON.stringify(contenido) });
  const data = await r.json();
  if (!r.ok) throw new Error(`JSONBin (${r.status}): ${data.message || 'error al guardar'}`);
  return data.record || data;
}

const leerCatalogo = () => leerBin(process.env.JSONBIN_BIN_ID);
const guardarCatalogo = lista => guardarBin(process.env.JSONBIN_BIN_ID, lista);

async function leerVentas() {
  const d = await leerBin(process.env.JSONBIN_VENTAS_BIN_ID);
  return { ventas: Array.isArray(d.ventas) ? d.ventas : [], proveedores: Array.isArray(d.proveedores) ? d.proveedores : [], ...d };
}
const guardarVentas = datos => guardarBin(process.env.JSONBIN_VENTAS_BIN_ID, datos);

// Cotizaciones del día (misma fuente que usa la tienda: dolarapi.com).
// Si la API falla, usa los valores de respaldo de las variables de entorno.
async function cotizaciones() {
  const respaldo = {
    blue: Number(process.env.DOLAR_BLUE_RESPALDO) || 0,
    oficial: Number(process.env.DOLAR_OFICIAL_RESPALDO) || 0,
    tarjeta: Number(process.env.DOLAR_TARJETA_RESPALDO) || 0
  };
  const traer = async tipo => {
    try {
      const r = await fetch(`https://dolarapi.com/v1/dolares/${tipo}`, { cache: 'no-store' });
      const d = await r.json();
      return Number(d.venta) || respaldo[tipo];
    } catch (e) {
      return respaldo[tipo];
    }
  };
  const [blue, oficial, tarjeta] = await Promise.all([traer('blue'), traer('oficial'), traer('tarjeta')]);
  return { blue, oficial, tarjeta };
}

function cotizacionDe(prod, cot) {
  if (prod.tipoCotizacion === 'oficial') return cot.oficial;
  if (prod.tipoCotizacion === 'tarjeta') return cot.tarjeta;
  return cot.blue;
}

// Mismo criterio que la tienda (index.html → estadoDisp)
function estadoDisp(p) {
  if (p.disponibilidad === 'Sin stock') return 'Sin stock';
  if (p.disponibilidad === 'A pedido') return 'A pedido';
  return Number(p.stock) > 0 ? 'En Stock' : 'Sin stock';
}

function sitioURL(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `https://${host}`;
}

module.exports = { leerCatalogo, guardarCatalogo, leerVentas, guardarVentas, cotizaciones, cotizacionDe, estadoDisp, sitioURL };
