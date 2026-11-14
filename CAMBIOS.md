# Cambios — Matos iPhone Rosario (noviembre 2026)

## 🔒 Seguridad (lo más importante)
- **`/api/jsonbin` ya no muestra tus costos al público.** Antes cualquiera que abriera
  `matosiphonesrosario.com.ar/api/jsonbin` veía `costoBaseUSD` de cada equipo (tu margen).
  Ahora el público recibe el catálogo sin costos y el panel admin, con contraseña, recibe todo.
- **Guardar el catálogo exige contraseña siempre** (antes, si faltaba `ADMIN_PASSWORD` en
  Vercel, cualquiera podía sobrescribirlo).
- El panel admin se niega a guardar si le llega el catálogo sin costos, para que nunca se borren.
- Se sacó del sitio el PDF `img/Detalle Reclamo #12075...pdf` (era un documento personal
  descargable por cualquiera).
- Se sacó el botón ⚙️ del panel admin de la tienda. El panel sigue en `/admin.html` (guardalo en favoritos).
- `admin.html` lleva `noindex` y `robots.txt` le pide a Google que no indexe `/admin.html` ni `/api/`.

## 🛒 Tienda
- **Link propio por equipo** (`/#equipo-1502`) + botón **Compartir** en la ficha: sirve
  para mandarlo por WhatsApp o ponerlo en historias de Instagram. El mensaje de consulta
  por WhatsApp ya incluye el link.
- **Ordenar**: Destacados (tu orden del panel), Modelos más nuevos, Menor/Mayor precio, Mejor batería.
- **Carrito**: foto, botones − / +, tope según el stock real, se sacan solos los equipos que
  se vendieron, y el mensaje de WhatsApp ahora lleva precio por ítem y total en USD y ARS.
- Ya no aparecen productos "de ejemplo" con fotos rotas mientras carga: se ve un esqueleto
  de carga (o la última copia guardada en el navegador).
- Contador "X productos · Y disponibles", leyenda de 18 cuotas + canje en la ficha.
- Sección **Cómo comprar** y **footer** con contacto.
- Cerrar ficha/carrito con Esc o tocando afuera; imágenes con carga diferida (`lazy`).

## ⚡ Velocidad y Google
- Imágenes de `img/` comprimidas: **~24 MB → ~5 MB**, mismos nombres de archivo (no hay que
  tocar nada en el panel).
- `Logo.png` 1,1 MB → 85 KB; `favicon.png` 389 KB → 19 KB.
- Vista previa al compartir el link (Open Graph) con imagen nueva `img/og-matos.jpg`.
- Datos estructurados de negocio local para Google, `sitemap.xml` y `robots.txt`.

## Cómo subirlo
1. Reemplazá los archivos del repo por los de esta carpeta (o subí el zip con GitHub Desktop).
   Borrá del repo el PDF del reclamo.
2. Vercel publica solo al hacer el commit.
3. Verificá que en Vercel → Settings → Environment Variables esté `ADMIN_PASSWORD`
   (si podés entrar al panel, ya está).
4. Entrá al panel, editá cualquier equipo y guardá: tiene que decir "Sincronizado".

## Pendiente recomendado
- **Hacer privado el repositorio de GitHub** (Settings → General → Danger Zone → Change
  visibility). Hoy es público y el PDF sigue en el historial. Vercel funciona igual con repos privados.
- Pasar Tailwind del CDN a CSS compilado (Tailwind v3) para que cargue más rápido.
