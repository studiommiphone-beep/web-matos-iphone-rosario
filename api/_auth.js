// ============================================================
// api/_auth.js — Ayudante compartido (Vercel NO lo expone como endpoint
// porque empieza con guion bajo). Valida la contraseña del admin en el
// SERVIDOR, comparándola con la variable de entorno ADMIN_PASSWORD.
// ============================================================
const crypto = require('crypto');

function passwordValida(req) {
  const esperada = process.env.ADMIN_PASSWORD || '';
  const recibida = String((req.headers && req.headers['x-admin-password']) || '');
  if (!esperada || !recibida) return false;
  const a = crypto.createHash('sha256').update(esperada).digest();
  const b = crypto.createHash('sha256').update(recibida).digest();
  return crypto.timingSafeEqual(a, b);
}

// Devuelve true si NO hay que seguir (ya respondió con error).
// estricto=true  -> si falta ADMIN_PASSWORD en Vercel, rechaza todo (datos sensibles: ventas).
// estricto=false -> si falta ADMIN_PASSWORD se permite (compatibilidad con tu catálogo
//                   actual), pero apenas la configurás en Vercel queda protegido.
function rechazar(req, res, estricto) {
  if (!process.env.ADMIN_PASSWORD) {
    if (!estricto) return false;
    res.status(500).json({ error: 'Falta configurar la variable de entorno ADMIN_PASSWORD en Vercel (Project Settings → Environment Variables). Debe ser la misma contraseña con la que entrás al panel.' });
    return true;
  }
  if (!passwordValida(req)) {
    res.status(401).json({ error: 'Contraseña de administrador incorrecta o sesión vencida. Volvé a ingresar al panel.' });
    return true;
  }
  return false;
}

module.exports = { passwordValida, rechazar };
