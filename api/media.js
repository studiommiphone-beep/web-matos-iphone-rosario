// ============================================================
// api/media.js — Función serverless de VERCEL
// Sube y borra las fotos/videos REALES de los equipos en stock
// (la galería del admin), usando Vercel Blob como almacenamiento.
// Reemplaza a la antigua netlify/functions/media.js (que usaba
// Netlify Blobs, un servicio que no existe fuera de Netlify).
//
// POST   -> sube un archivo. Body JSON: { filename, contentType, data }
//           "data" es el archivo en base64 (sin el prefijo data:...;base64,)
//           Devuelve: { key, url }  (key y url son la misma URL pública)
// DELETE -> ?key=<url>  borra el archivo
//
// Requiere tener un "Blob Store" creado en tu proyecto de Vercel
// (Storage → Create Database → Blob). Al crearlo, Vercel agrega
// automáticamente la variable de entorno BLOB_READ_WRITE_TOKEN.
// ============================================================

const { put, del } = require('@vercel/blob');

// Límite práctico: mantenemos el mismo límite que usábamos en Netlify
const MAX_SIZE_BYTES = 6 * 1024 * 1024;

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  try {
    if (req.method === 'POST') {
      const { filename, contentType, data } = req.body || {};

      if (!data || !contentType) {
        return res.status(400).json({ error: 'Faltan datos del archivo (contentType o data).' });
      }

      const buffer = Buffer.from(data, 'base64');
      if (buffer.length > MAX_SIZE_BYTES) {
        return res.status(413).json({ error: 'El archivo pesa demasiado (máximo 6MB). Comprimí la foto o acortá el video antes de subirlo.' });
      }

      const safeName = String(filename || 'archivo').replace(/[^a-zA-Z0-9.\-_]/g, '_');
      const pathname = `media-matos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

      const blob = await put(pathname, buffer, {
        access: 'public',
        contentType,
        addRandomSuffix: false
      });

      // La URL de Vercel Blob ya es pública y permanente: la usamos
      // como "key" también, para no tener que tocar el resto del panel.
      return res.status(200).json({ key: blob.url, url: blob.url });
    }

    if (req.method === 'DELETE') {
      const key = req.query && req.query.key;
      if (!key) return res.status(400).json({ error: 'Falta el parámetro key.' });
      await del(key);
      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};