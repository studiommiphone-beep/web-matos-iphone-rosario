// ============================================================
// CONFIGURACIÓN GLOBAL — Matos iPhone Rosario
// Este archivo lo usan tanto index.html (tienda) como admin.html
// (panel de administración). Si cambiás el WhatsApp o Instagram,
// hacelo acá una sola vez.
//
// 🔒 La contraseña del panel YA NO está en este archivo: se configura
// como variable de entorno ADMIN_PASSWORD en Vercel (así no queda
// expuesta en GitHub ni en el código de la página).
// ============================================================

const CONFIG = {
  whatsapp: '5493413230764',
  instagram: 'https://www.instagram.com/matosiphonerosario/',
  dolarInicial: 1560,
  dolarOficialInicial: 1050,
  dolarTarjetaInicial: 1680
};

// ------------------------------------------------------------
// PANEL DE VENTAS (solo lo usa admin.html)
// Recargos que le cobrás al cliente según el medio de pago (en %).
// ⚠️ Los valores de abajo son EJEMPLOS: reemplazalos por los reales
// de tu procesador de pagos (Mercado Pago, Payway, etc.).
// En cada venta igual podés cambiarlos a mano.
// ------------------------------------------------------------
const VENTAS_CONFIG = {
  // Recargo de tarjeta de crédito según cantidad de cuotas
  recargoCreditoPorCuotas: { 1: 8, 3: 15, 6: 25, 9: 35, 12: 45 },
  recargoDebito: 3,
  recargoTransferencia: 0,
  recargoEfectivo: 0,       // poné un número negativo para dar descuento (ej. -5)
  recargoUSD: 0,
  recargoCripto: 0,
  recargoFinanciado: 0      // interés por vender "a pagar"
};
