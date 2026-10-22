// ============================================================
// api/ventas.js — Función serverless de VERCEL
// Lee y guarda ventas, planes de pago (equipos a pagar) y proveedores
// en un SEGUNDO bin de JSONBin.io (separado del catálogo, para no tocar
// lo que ve el público en la tienda).
//
// Variables de entorno necesarias en Vercel:
//   JSONBIN_VENTAS_BIN_ID  -> ID del bin nuevo para ventas
//   JSONBIN_KEY            -> la misma Master Key que ya usás
//   ADMIN_PASSWORD         -> la contraseña del panel (se valida acá)
//
// Todas las operaciones requieren la contraseña (header x-admin-password):
// los datos de ventas y deudores son sensibles y NO pueden ser públicos.
// ============================================================
const { rechazar } = require('./_auth');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (rechazar(req, res, true)) return;

  const BIN_ID = process.env.JSONBIN_VENTAS_BIN_ID;
  const API_KEY = process.env.JSONBIN_KEY;
  if (!BIN_ID || !API_KEY) {
    return res.status(500).json({
      error: 'Faltan las variables de entorno JSONBIN_VENTAS_BIN_ID y/o JSONBIN_KEY en Vercel. Creá un bin nuevo en jsonbin.io con {"ventas":[],"proveedores":[]} y pegá su ID.'
    });
  }

  const URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;
  const headers = { 'Content-Type': 'application/json', 'X-Master-Key': API_KEY };

  try {
    if (req.method === 'GET') {
      const r = await fetch(`${URL}/latest`, { method: 'GET', headers, cache: 'no-store' });
      const data = await r.json();
      if (!r.ok) return res.status(502).json({ error: `JSONBin respondió con error (${r.status}): ${data.message || JSON.stringify(data)}` });
      return res.status(200).json(data.record ? data.record : data);
    }

    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || typeof body !== 'object' || !Array.isArray(body.ventas) || !Array.isArray(body.proveedores)) {
        return res.status(400).json({ error: 'Formato inválido: se esperaba { ventas: [], proveedores: [] }.' });
      }
      const r = await fetch(URL, { method: 'PUT', headers, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) return res.status(502).json({ error: `JSONBin respondió con error (${r.status}) al guardar: ${data.message || JSON.stringify(data)}` });
      return res.status(200).json(data.record || data);
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
