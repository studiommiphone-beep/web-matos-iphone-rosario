// ============================================================
// api/jsonbin.js — Función serverless de VERCEL
// Lee y guarda el catálogo de productos en JSONBin.io
// Reemplaza a la antigua netlify/functions/jsonbin.js
//
// Variables de entorno necesarias (Vercel → Project Settings →
// Environment Variables): JSONBIN_BIN_ID y JSONBIN_KEY
// ============================================================

module.exports = async (req, res) => {
  const BIN_ID = process.env.JSONBIN_BIN_ID;
  const API_KEY = process.env.JSONBIN_KEY;

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  // Si faltan las variables de entorno, avisamos clarito en vez de fallar en silencio
  if (!BIN_ID || !API_KEY) {
    return res.status(500).json({
      error: 'Faltan configurar las variables de entorno JSONBIN_BIN_ID y/o JSONBIN_KEY en Vercel (Project Settings → Environment Variables). Sin esto, el catálogo no puede guardarse ni leerse desde la nube.'
    });
  }

  const URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Master-Key': API_KEY
  };

  try {
    // LEER DATOS (GET)
    if (req.method === 'GET') {
      const response = await fetch(`${URL}/latest`, { method: 'GET', headers, cache: 'no-store' });
      const data = await response.json();

      if (!response.ok) {
        return res.status(502).json({ error: `JSONBin respondió con error (${response.status}): ${data.message || JSON.stringify(data)}` });
      }

      // Devuelve data.record si existe, o el objeto directo
      const recordData = data.record ? data.record : data;
      return res.status(200).json(recordData);
    }

    // GUARDAR DATOS (PUT)
    if (req.method === 'PUT') {
      const bodyData = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const response = await fetch(URL, {
        method: 'PUT',
        headers,
        body: JSON.stringify(bodyData)
      });
      const data = await response.json();

      if (!response.ok) {
        return res.status(502).json({ error: `JSONBin respondió con error (${response.status}) al guardar: ${data.message || JSON.stringify(data)}` });
      }

      return res.status(200).json(data.record || data);
    }

    return res.status(405).json({ error: 'Método no permitido' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};