// ============================================================
// api/auth.js — Verifica la contraseña del panel contra la variable
// de entorno ADMIN_PASSWORD (así la contraseña ya no vive en el código
// que subís a GitHub).
// ============================================================
const { rechazar } = require('./_auth');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (rechazar(req, res, true)) return;
  return res.status(200).json({ ok: true });
};
