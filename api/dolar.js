// ============================================================
// api/dolar.js — Cotización que usa la tienda para mostrar precios en pesos.
// Blue = venta del "Dólar Blue en Rosario" de infodolar.com (ver api/_tienda.js).
// Vercel guarda la respuesta 10 minutos, así no se consulta infodolar en cada visita.
// ============================================================
const { cotizaciones } = require('./_tienda');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const cot = await cotizaciones();
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
    return res.status(200).json(cot);
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ error: error.message });
  }
};
