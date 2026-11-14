// ============================================================
// api/jsonbin.js — Función serverless de VERCEL
// Lee y guarda el catálogo de productos en JSONBin.io
// Reemplaza a la antigua netlify/functions/jsonbin.js
//
// Variables de entorno necesarias (Vercel → Project Settings →
// Environment Variables): JSONBIN_BIN_ID y JSONBIN_KEY
// ============================================================

const { rechazar, passwordValida } = require('./_auth');

// Campos internos que el público NUNCA debe ver (el costo deja ver tu margen).
// El IMEI parcial (últimos dígitos) se sigue mostrando: va en el mensaje de WhatsApp
// para que identifiques la unidad exacta.
// Solo se devuelven completos si el pedido trae la contraseña del admin.
const CAMPOS_PRIVADOS = ['costoBaseUSD', 'proveedor', 'proveedorId', 'notasInternas'];

function versionPublica(lista) {
  if (!Array.isArray(lista)) return lista;
  return lista.map(prod => {
    if (!prod || typeof prod !== 'object') return prod;
    const copia = { ...prod };
    CAMPOS_PRIVADOS.forEach(campo => delete copia[campo]);
    // De la galería sacamos la "key" interna de borrado; dejamos url/tipo
    if (Array.isArray(copia.galeria)) {
      copia.galeria = copia.galeria.map(({ key, ...resto }) => resto);
    }
    return copia;
  });
}

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
      // Con contraseña válida (panel admin) va todo; para el público, sin costos
      const esAdmin = process.env.ADMIN_PASSWORD && passwordValida(req);
      return res.status(200).json(esAdmin ? recordData : versionPublica(recordData));
    }

    // GUARDAR DATOS (PUT) — SIEMPRE requiere la contraseña del admin
    if (req.method === 'PUT') {
      if (rechazar(req, res, true)) return;
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