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

// ---------- Cotización del dólar ----------
// Blue: precio de VENTA del "Dólar Blue en Rosario" de infodolar.com.
// Si infodolar no responde, usa dolarapi.com; si tampoco, el valor de respaldo.
const INFODOLAR_URL = 'https://www.infodolar.com/cotizacion-dolar-localidad-rosario-provincia-santa-fe.aspx';
let cacheCot = null; // se guarda 10 minutos por instancia del servidor
const CACHE_MS = 10 * 60 * 1000;

const numeroAR = txt => Number(String(txt).replace(/\./g, '').replace(',', '.'));
const valido = n => Number.isFinite(n) && n > 100 && n < 100000;

async function blueRosarioInfodolar() {
  const r = await fetch(INFODOLAR_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MatosIphoneBot/1.0)', 'Accept-Language': 'es-AR' },
    signal: AbortSignal.timeout(6000)
  });
  if (!r.ok) throw new Error(`infodolar respondió ${r.status}`);
  const html = await r.text();
  // Fila "Dólar Blue en Rosario": 1ra celda = compra, 2da = venta
  const m = html.match(/D(?:ó|o|&oacute;)lar Blue<\/a>\s*en Rosario[\s\S]{0,400}?data-order="\$\s*([\d.,]+)"[\s\S]{0,600}?data-order="\$\s*([\d.,]+)"/i);
  if (!m) throw new Error('No encontré la fila Dólar Blue en Rosario');
  const venta = numeroAR(m[2]);
  if (!valido(venta)) throw new Error(`Valor raro de infodolar: ${m[2]}`);
  return { venta, compra: numeroAR(m[1]) };
}

async function dolarapi(tipo) {
  const r = await fetch(`https://dolarapi.com/v1/dolares/${tipo}`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
  const d = await r.json();
  const v = Number(d.venta);
  if (!valido(v)) throw new Error(`dolarapi ${tipo} sin dato`);
  return v;
}

async function cotizaciones() {
  if (cacheCot && Date.now() - cacheCot.ts < CACHE_MS) return cacheCot.valor;
  const respaldo = {
    blue: Number(process.env.DOLAR_BLUE_RESPALDO) || 0,
    oficial: Number(process.env.DOLAR_OFICIAL_RESPALDO) || 0,
    tarjeta: Number(process.env.DOLAR_TARJETA_RESPALDO) || 0
  };

  let blue = 0, fuenteBlue = 'respaldo';
  try {
    blue = (await blueRosarioInfodolar()).venta;
    fuenteBlue = 'infodolar (Blue Rosario, venta)';
  } catch (e) {
    console.error('infodolar falló, uso dolarapi:', e.message);
    try { blue = await dolarapi('blue'); fuenteBlue = 'dolarapi (blue)'; } catch (e2) { blue = respaldo.blue; }
  }
  const [oficial, tarjeta] = await Promise.all(
    ['oficial', 'tarjeta'].map(t => dolarapi(t).catch(() => respaldo[t]))
  );

  const valor = { blue, oficial, tarjeta, fuenteBlue, actualizado: new Date().toISOString() };
  if (valido(blue)) cacheCot = { ts: Date.now(), valor };
  return valor;
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
