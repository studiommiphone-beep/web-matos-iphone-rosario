// ============================================================
// FUNCIÓN: media.js
// Sube y sirve las fotos/videos REALES de los equipos en stock
// (la galería del admin), usando Netlify Blobs como almacenamiento.
//
// POST   -> sube un archivo. Body JSON: { filename, contentType, data }
//           "data" es el archivo en base64 (sin el prefijo data:...;base64,)
//           Devuelve: { key, url }
// GET    -> ?key=xxx  devuelve el archivo (imagen o video)
// DELETE -> ?key=xxx  borra el archivo
// ============================================================

const { getStore } = require('@netlify/blobs');

// Límite práctico: Netlify Functions no acepta payloads mayores a ~6MB
const MAX_SIZE_BYTES = 6 * 1024 * 1024;

exports.handler = async (event) => {
  let store;
  try {
    store = getStore('media-matos');
  } catch (error) {
    return json(500, { error: 'No se pudo inicializar el almacenamiento de archivos (Netlify Blobs). Verificá que el sitio esté desplegado en Netlify.' });
  }

  try {
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { filename, contentType, data } = body;

      if (!data || !contentType) {
        return json(400, { error: 'Faltan datos del archivo (contentType o data).' });
      }

      const buffer = Buffer.from(data, 'base64');
      if (buffer.length > MAX_SIZE_BYTES) {
        return json(413, { error: 'El archivo pesa demasiado (máximo 6MB). Comprimí la foto o acortá el video antes de subirlo.' });
      }

      const safeName = String(filename || 'archivo').replace(/[^a-zA-Z0-9.\-_]/g, '_');
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

      await store.set(key, buffer, { metadata: { contentType } });

      return json(200, { key, url: `/.netlify/functions/media?key=${encodeURIComponent(key)}` });
    }

    if (event.httpMethod === 'GET') {
      const key = event.queryStringParameters && event.queryStringParameters.key;
      if (!key) return json(400, { error: 'Falta el parámetro key.' });

      const result = await store.getWithMetadata(key, { type: 'buffer' });
      if (!result) return json(404, { error: 'Archivo no encontrado.' });

      const contentType = (result.metadata && result.metadata.contentType) || 'application/octet-stream';

      return {
        statusCode: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000, immutable'
        },
        body: result.data.toString('base64'),
        isBase64Encoded: true
      };
    }

    if (event.httpMethod === 'DELETE') {
      const key = event.queryStringParameters && event.queryStringParameters.key;
      if (!key) return json(400, { error: 'Falta el parámetro key.' });
      await store.delete(key);
      return json(200, { deleted: true });
    }

    return json(405, { error: 'Método no permitido' });
  } catch (error) {
    return json(500, { error: error.message });
  }
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  };
}
