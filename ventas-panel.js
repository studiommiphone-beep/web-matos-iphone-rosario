// ============================================================
// ventas-panel.js — Panel de Ventas, Equipos a pagar y Proveedores
// Matos iPhone Rosario
//
// Lo usa admin.html. Guarda todo en /api/ventas (bin aparte de
// JSONBin, protegido con contraseña). El catálogo sigue en /api/jsonbin.
//
// Conceptos:
//   Bruto  = lo que paga el cliente (con recargos de tarjeta, etc.)
//   Neto   = bruto menos lo que te retiene el medio de pago
//   Queda  = neto menos el costo del equipo y gastos (tu ganancia)
// ============================================================
(function (global) {
  'use strict';

  // ---------- Configuración (se puede pisar desde config.js → VENTAS_CONFIG) ----------
  const DEF = {
    recargoCreditoPorCuotas: { 1: 8, 3: 15, 6: 25, 9: 35, 12: 45 },
    recargoDebito: 3,
    recargoTransferencia: 0,
    recargoEfectivo: 0,
    recargoUSD: 0,
    recargoCripto: 0,
    recargoFinanciado: 0
  };
  const VC = Object.assign({}, DEF, typeof VENTAS_CONFIG !== 'undefined' ? VENTAS_CONFIG : {});

  const METODOS = {
    efectivo:      { label: 'Efectivo',      ic: 'fa-money-bill-wave',  moneda: 'ARS' },
    transferencia: { label: 'Transferencia', ic: 'fa-building-columns', moneda: 'ARS' },
    debito:        { label: 'Débito',        ic: 'fa-credit-card',      moneda: 'ARS' },
    credito:       { label: 'Crédito',       ic: 'fa-credit-card',      moneda: 'ARS' },
    usd:           { label: 'USD',           ic: 'fa-dollar-sign',      moneda: 'USD' },
    cripto:        { label: 'Cripto',        ic: 'fa-coins',            moneda: 'USD' },
    financiado:    { label: 'A pagar',       ic: 'fa-hourglass-half',   moneda: 'USD' }
  };

  const LS_KEY = 'matos_ventas_v1';

  // ---------- Helpers ----------
  const $ = id => document.getElementById(id);
  const esc = (v = '') => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  const nUSD = v => new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(v || 0);
  const nARS = v => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Math.round(v || 0));
  const fUSD = v => 'US$ ' + nUSD(v);
  const fARS = v => '$ ' + nARS(v);
  const num = v => {
    v = String(v == null ? '' : v).replace(/[^\d.,-]/g, '');
    if (/^-?\d{1,3}(\.\d{3})+$/.test(v)) v = v.replace(/\./g, '');
    else if (v.includes(',') && v.includes('.')) v = v.replace(/\./g, '').replace(',', '.');
    else v = v.replace(',', '.');
    return Number(v) || 0;
  };
  const hoyISO = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const fmtF = iso => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
  const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const toast = m => (typeof showToast === 'function' ? showToast(m) : alert(m));
  const cotHoy = () => (typeof dolarBlueRosario !== 'undefined' && dolarBlueRosario) || (typeof CONFIG !== 'undefined' && CONFIG.dolarInicial) || 1500;
  const listaProductos = () => (typeof productos !== 'undefined' && Array.isArray(productos) ? productos : []);
  const regaloCosto = () => (typeof ACCESORIOS_REGALO_COSTO !== 'undefined' ? ACCESORIOS_REGALO_COSTO : 0);
  const authHeaders = () => ({ 'Content-Type': 'application/json', 'x-admin-password': sessionStorage.getItem('matos_admin_pw') || '' });

  function addMonths(iso, k) {
    const [y, m, d] = iso.split('-').map(Number);
    const base = new Date(y, m - 1 + k, 1);
    const dias = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    base.setDate(Math.min(d, dias));
    return base.getFullYear() + '-' + String(base.getMonth() + 1).padStart(2, '0') + '-' + String(base.getDate()).padStart(2, '0');
  }
  function diasEntre(a, b) { // b - a en días
    const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
  }

  // ---------- Cálculos (puros) ----------
  function recargoDefault(metodo, cuotas) {
    if (metodo === 'credito') return Number(VC.recargoCreditoPorCuotas[cuotas] || 0);
    const t = { debito: VC.recargoDebito, transferencia: VC.recargoTransferencia, efectivo: VC.recargoEfectivo, usd: VC.recargoUSD, cripto: VC.recargoCripto, financiado: VC.recargoFinanciado };
    return Number(t[metodo] || 0);
  }
  const comisionDefault = (metodo, cuotas) => (metodo === 'debito' || metodo === 'credito') ? recargoDefault(metodo, cuotas) : 0;

  function calcularVenta(v) {
    const cant = Math.max(1, Number(v.cantidad) || 1);
    const baseUSD = (Number(v.precioUSD) || 0) * cant;
    const costoTotalUSD = (Number(v.costoUSD) || 0) * cant + (Number(v.gastosUSD) || 0);
    const recargoUSD = baseUSD * (Number(v.recargoPct) || 0) / 100;
    const brutoUSD = baseUSD + recargoUSD;
    const comisionUSD = baseUSD * (Number(v.comisionPct) || 0) / 100;
    const netoUSD = brutoUSD - comisionUSD;
    const cot = Number(v.cot) || 0;
    const brutoARS = brutoUSD * cot;
    const cuotas = v.metodo === 'credito' ? Math.max(1, Number(v.cuotas) || 1) : 0;
    return {
      cant, baseUSD, costoTotalUSD, recargoUSD, brutoUSD, comisionUSD, netoUSD,
      gananciaUSD: netoUSD - costoTotalUSD, brutoARS,
      valorCuotaARS: cuotas ? brutoARS / cuotas : 0, cuotas
    };
  }

  const pagadoUSD = v => v.financiado ? v.financiado.pagos.reduce((s, p) => s + (Number(p.usd) || 0), 0) : v.brutoUSD;
  const debeUSD = v => v.financiado ? Math.max(0, v.brutoUSD - pagadoUSD(v)) : 0;

  function estadoPlan(v, hoy) {
    hoy = hoy || hoyISO();
    const f = v.financiado, total = v.brutoUSD, pagado = pagadoUSD(v), debe = Math.max(0, total - pagado);
    const saldado = debe < 0.005;
    const r = { total, pagado, debe, saldado, proxVenc: null, vencido: false, diasVenc: 0, valorCuotaUSD: 0, cuotasCubiertas: 0 };
    if (!saldado && f.cuotasPactadas > 0 && f.primerVencimiento) {
      const entrega = f.pagos.filter(p => p.esEntrega).reduce((s, p) => s + p.usd, 0);
      r.valorCuotaUSD = Math.max(0, total - entrega) / f.cuotasPactadas;
      r.cuotasCubiertas = r.valorCuotaUSD > 0 ? Math.floor((pagado - entrega + 0.01) / r.valorCuotaUSD) : f.cuotasPactadas;
      r.cuotasCubiertas = Math.max(0, Math.min(f.cuotasPactadas, r.cuotasCubiertas));
      r.proxVenc = addMonths(f.primerVencimiento, r.cuotasCubiertas);
      r.diasVenc = diasEntre(r.proxVenc, hoy); // >0: vencido hace N días
      r.vencido = r.diasVenc > 0;
    }
    return r;
  }

  function resumen(list) {
    const o = { n: list.length, brutoUSD: 0, brutoARS: 0, netoUSD: 0, netoARS: 0, costoUSD: 0, gananciaUSD: 0, gananciaARS: 0, cobradoUSD: 0, porCobrarUSD: 0 };
    list.forEach(v => {
      o.brutoUSD += v.brutoUSD; o.brutoARS += v.brutoARS;
      o.netoUSD += v.netoUSD; o.netoARS += v.netoUSD * v.cot;
      o.costoUSD += v.costoTotalUSD;
      o.gananciaUSD += v.gananciaUSD; o.gananciaARS += v.gananciaUSD * v.cot;
      o.cobradoUSD += pagadoUSD(v); o.porCobrarUSD += debeUSD(v);
    });
    return o;
  }

  // ---------- Estado ----------
  let datos = { ventas: [], proveedores: [] };
  let nubeOk = false, busy = false, inited = false, origen = 'catalogo', metodo = 'efectivo';
  let planAbierto = {}, lastError = '';

  const normalizar = d => ({
    ventas: Array.isArray(d && d.ventas) ? d.ventas : [],
    proveedores: Array.isArray(d && d.proveedores) ? d.proveedores : []
  });

  async function cargar() {
    try {
      const r = await fetch('/api/ventas', { headers: authHeaders(), cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) { alert(d.error || 'Sesión vencida.'); if (typeof cerrarSesion === 'function') cerrarSesion(); return; }
      if (!r.ok || d.error) throw new Error(d.error || 'Error HTTP ' + r.status);
      datos = normalizar(d); nubeOk = true;
      try { localStorage.setItem(LS_KEY, JSON.stringify(datos)); } catch (e) { /* ignore */ }
      setBanner('');
    } catch (e) {
      nubeOk = false; lastError = e.message;
      try { datos = normalizar(JSON.parse(localStorage.getItem(LS_KEY) || '{}')); } catch (_) { datos = normalizar({}); }
      setBanner(e.message);
    }
  }
  async function guardar() {
    if (!nubeOk) { toast('⚠️ Sin conexión con la nube: no se puede guardar. Tocá "Reintentar".'); return false; }
    try {
      const r = await fetch('/api/ventas', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(datos) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) { alert(d.error || 'Sesión vencida.'); if (typeof cerrarSesion === 'function') cerrarSesion(); return false; }
      if (!r.ok || d.error) throw new Error(d.error || 'Error HTTP ' + r.status);
      try { localStorage.setItem(LS_KEY, JSON.stringify(datos)); } catch (e) { /* ignore */ }
      return true;
    } catch (e) { toast('⚠️ No se guardó en la nube: ' + e.message); return false; }
  }
  // Aplica un cambio; si no se puede guardar en la nube, lo deshace.
  async function mutar(fn) {
    if (busy) { toast('Guardando, esperá un segundo...'); return false; }
    busy = true;
    const snap = JSON.stringify(datos);
    try {
      fn();
      const ok = await guardar();
      if (!ok) datos = JSON.parse(snap);
      renderTodo();
      return ok;
    } finally { busy = false; }
  }
  function setBanner(msg) {
    document.querySelectorAll('.vp-banner').forEach(el => {
      if (!msg) { el.classList.add('hidden'); el.innerHTML = ''; return; }
      el.classList.remove('hidden');
      el.innerHTML = `<div class="flex flex-wrap items-center justify-between gap-2"><span><i class="fa-solid fa-triangle-exclamation mr-1"></i><b>Sin conexión con la nube — modo solo lectura.</b> ${esc(msg)}</span><button type="button" onclick="VP.reintentar()" class="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 font-bold text-white">Reintentar</button></div>`;
    });
  }
  async function reintentar() { await cargar(); renderTodo(); if (nubeOk) toast('Conectado ✅'); }

  // ---------- Pestañas ----------
  function tab(name) {
    ['catalogo', 'ventas', 'financiados', 'proveedores'].forEach(t => {
      const sec = $('tab-' + t); if (sec) sec.classList.toggle('hidden', t !== name);
    });
    document.querySelectorAll('#tabs-nav .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    try { sessionStorage.setItem('matos_tab', name); } catch (e) { /* ignore */ }
    if (inited && name === 'ventas') renderOpcionesProductos();
    if (name !== 'catalogo') window.scrollTo({ top: 0 });
  }

  // ============================================================
  // ESQUELETOS HTML
  // ============================================================
  const INP = 'w-full rounded-xl p-3 bg-white/10 border border-white/10 outline-none text-sm';
  const SEL = 'w-full rounded-xl p-3 bg-slate-800 border border-white/10 outline-none text-sm';
  const L = t => `<label class="text-xs text-slate-400 mb-1 block">${t}</label>`;
  const BANNER = '<div class="vp-banner hidden mb-4 p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs"></div>';
  const CARD = 'bg-white/5 p-5 rounded-2xl border border-white/10';

  function esqueletoVentas() {
    const botonesMetodo = Object.entries(METODOS).map(([k, m]) =>
      `<button type="button" data-m="${k}" onclick="VP.setMetodo('${k}')" class="vf-m rounded-xl border p-2.5 text-xs font-bold transition"><i class="fa-solid ${m.ic} block text-base mb-1"></i>${m.label}</button>`).join('');
    const opcCuotas = Object.keys(VC.recargoCreditoPorCuotas).map(c => `<option value="${c}">${c} ${c === '1' ? 'pago' : 'cuotas'} (+${VC.recargoCreditoPorCuotas[c]}%)</option>`).join('');
    return `
    ${BANNER}
    <section class="bg-white/5 p-5 rounded-2xl border border-blue-500/30">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-sm font-bold text-blue-400 uppercase tracking-wider"><i class="fa-solid fa-cash-register mr-1"></i> Registrar venta</h3>
        <div class="flex gap-1 bg-white/5 rounded-xl p-1 text-xs font-bold">
          <button type="button" id="vf-o-catalogo" onclick="VP.setOrigen('catalogo')" class="px-3 py-2 rounded-lg">Del catálogo</button>
          <button type="button" id="vf-o-manual" onclick="VP.setOrigen('manual')" class="px-3 py-2 rounded-lg">Manual</button>
        </div>
      </div>

      <div class="grid lg:grid-cols-3 gap-5 mt-4">
        <div class="lg:col-span-2 space-y-4">

          <div id="vf-box-catalogo" class="space-y-2">
            ${L('Producto del catálogo')}
            <input id="vf-q" oninput="VP.filtrarProductos()" placeholder="Buscar por modelo, detalle o IMEI..." class="${INP}">
            <select id="vf-prod" onchange="VP.onProducto()" class="${SEL}"></select>
            <p id="vf-prod-info" class="text-[11px] text-slate-400"></p>
          </div>

          <div id="vf-box-manual" class="hidden grid sm:grid-cols-3 gap-3">
            <div class="sm:col-span-2">${L('Artículo')}<input id="vf-nombre" oninput="VP.preview()" placeholder="Ej. iPhone 12 128GB (permuta)" class="${INP}"></div>
            <div>${L('IMEI (opcional)')}<input id="vf-imei" maxlength="20" class="${INP}"></div>
            <div class="sm:col-span-3">${L('Detalle (opcional)')}<input id="vf-specs" placeholder="Color, batería, estado..." class="${INP}"></div>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>${L('Cantidad')}<input id="vf-cant" type="number" min="1" value="1" oninput="VP.preview()" class="${INP}"></div>
            <div>${L('Precio venta c/u (USD)')}<input id="vf-precio" inputmode="decimal" oninput="VP.preview()" class="${INP} border-emerald-500/40 text-emerald-300 font-bold"></div>
            <div>${L('Costo c/u (USD)')}<input id="vf-costo" inputmode="decimal" oninput="VP.preview()" class="${INP}"></div>
            <div>${L('Otros gastos (USD)')}<input id="vf-gastos" inputmode="decimal" value="0" oninput="VP.preview()" title="Ej: accesorios de regalo, flete, reparación" class="${INP}"></div>
          </div>

          <div class="grid sm:grid-cols-3 gap-3">
            <div>
              ${L('Proveedor (a quién se lo compraste)')}
              <div class="flex gap-2">
                <select id="vf-prov" class="${SEL}"></select>
                <button type="button" onclick="VP.proveedorRapido()" title="Agregar proveedor" class="shrink-0 px-3 rounded-xl bg-white/10 hover:bg-white/15"><i class="fa-solid fa-plus"></i></button>
              </div>
            </div>
            <div>${L('Cliente (opcional)')}<input id="vf-cliente" oninput="VP.preview()" placeholder="Nombre" class="${INP}"></div>
            <div>${L('Teléfono cliente')}<input id="vf-tel" inputmode="tel" placeholder="341..." class="${INP}"></div>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>${L('Fecha')}<input id="vf-fecha" type="date" class="${INP}"></div>
            <div>${L('Cotización USD→ARS')}<input id="vf-cot" inputmode="decimal" oninput="VP.preview()" class="${INP}"></div>
            <div class="col-span-2 sm:col-span-1">${L('Notas')}<input id="vf-notas" class="${INP}"></div>
          </div>

          <div>
            ${L('Medio de pago')}
            <div class="grid grid-cols-4 sm:grid-cols-7 gap-2">${botonesMetodo}</div>
          </div>

          <div id="vf-p-credito" class="hidden">${L('Cuotas de la tarjeta de crédito')}<select id="vf-cuotas" onchange="VP.onCuotas()" class="${SEL}">${opcCuotas}</select></div>

          <div id="vf-p-cripto" class="hidden grid sm:grid-cols-2 gap-3">
            <div>${L('Moneda cripto')}<select id="vf-cripto-moneda" class="${SEL}"><option>USDT</option><option>USDC</option><option>BTC</option><option>ETH</option><option>Otra</option></select></div>
            <div>${L('Red / referencia (opcional)')}<input id="vf-cripto-nota" placeholder="Ej. TRC20, hash..." class="${INP}"></div>
          </div>

          <div id="vf-p-fin" class="hidden space-y-3 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
            <p class="text-[11px] text-amber-300"><i class="fa-solid fa-circle-info mr-1"></i>Equipo entregado a pagar. Queda en la pestaña <b>A pagar</b> para ir cargando los pagos. Requiere nombre del cliente.</p>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>${L('Entrega inicial')}<input id="vf-ent-monto" inputmode="decimal" placeholder="0" oninput="VP.preview()" class="${INP}"></div>
              <div>${L('Moneda')}<select id="vf-ent-moneda" onchange="VP.preview()" class="${SEL}"><option value="USD">USD</option><option value="ARS">ARS</option></select></div>
              <div>${L('Cuotas pactadas')}<input id="vf-fin-n" type="number" min="0" placeholder="Ej. 4" oninput="VP.preview()" class="${INP}"></div>
              <div>${L('1er vencimiento')}<input id="vf-fin-venc" type="date" class="${INP}"></div>
            </div>
          </div>

          <div class="grid sm:grid-cols-2 gap-3">
            <div>${L('Recargo (+) o descuento (−) al cliente, %')}<input id="vf-recargo" inputmode="decimal" oninput="VP.preview()" class="${INP}"></div>
            <div>${L('Lo que me retiene el medio de pago, % del precio')}<input id="vf-comision" inputmode="decimal" oninput="VP.preview()" class="${INP}"></div>
          </div>

          <label id="vf-stock-wrap" class="flex items-center gap-2 text-xs text-slate-300"><input id="vf-stock" type="checkbox" checked> Descontar del stock del catálogo</label>
        </div>

        <div>
          <div id="vf-preview" class="lg:sticky lg:top-28 ${CARD} space-y-3"></div>
          <button type="button" onclick="VP.registrar()" class="mt-3 w-full bg-blue-600 hover:bg-blue-500 py-3.5 rounded-xl font-extrabold transition text-sm shadow-lg">Registrar venta</button>
        </div>
      </div>
    </section>

    <section class="mt-8">
      <div class="flex flex-wrap items-end justify-between gap-3 mb-3">
        <h3 class="font-heading text-lg font-bold">Resumen de ventas</h3>
        <div class="flex flex-wrap gap-2 items-center">
          <select id="vp-periodo" onchange="VP.renderVentas()" class="rounded-xl p-2.5 bg-slate-800 border border-white/10 text-xs font-bold">
            <option value="mes">Este mes</option><option value="hoy">Hoy</option><option value="7d">Últimos 7 días</option>
            <option value="mesant">Mes anterior</option><option value="anio">Este año</option><option value="todo">Todo</option><option value="rango">Personalizado</option>
          </select>
          <span id="vp-rango" class="hidden flex gap-2 items-center">
            <input id="vp-desde" type="date" onchange="VP.renderVentas()" class="rounded-xl p-2 bg-white/10 border border-white/10 text-xs">
            <input id="vp-hasta" type="date" onchange="VP.renderVentas()" class="rounded-xl p-2 bg-white/10 border border-white/10 text-xs">
          </span>
        </div>
      </div>
      <div id="vp-kpis"></div>
      <div id="vp-medios" class="mt-4 ${CARD}"></div>
    </section>

    <section class="mt-8">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h3 class="font-heading text-lg font-bold">Ventas registradas</h3>
        <div class="flex flex-wrap gap-2">
          <input id="vp-q" oninput="VP.renderVentas()" placeholder="Buscar artículo, cliente, proveedor..." class="rounded-xl p-2.5 bg-white/10 border border-white/10 text-xs outline-none w-56">
          <select id="vp-fmedio" onchange="VP.renderVentas()" class="rounded-xl p-2.5 bg-slate-800 border border-white/10 text-xs font-bold">
            <option value="">Todos los medios</option>${Object.entries(METODOS).map(([k, m]) => `<option value="${k}">${m.label}</option>`).join('')}
          </select>
          <button type="button" onclick="VP.exportarCSV()" class="text-xs font-bold px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15"><i class="fa-solid fa-download mr-1"></i>CSV</button>
        </div>
      </div>
      <p class="sm:hidden text-[11px] text-slate-500 mb-2"><i class="fa-solid fa-arrows-left-right mr-1"></i>Deslizá la tabla hacia los costados</p>
      <div class="overflow-x-auto rounded-2xl border border-white/10" style="-webkit-overflow-scrolling: touch;">
        <table class="w-full text-left text-xs" style="min-width: 820px;">
          <thead class="bg-white/5 text-slate-400 font-bold uppercase"><tr>
            <th class="p-3">Fecha</th><th class="p-3">Artículo</th><th class="p-3">Medio de pago</th>
            <th class="p-3 text-right">Bruto</th><th class="p-3 text-right">Neto</th><th class="p-3 text-right">Queda</th><th class="p-3 text-right"></th>
          </tr></thead>
          <tbody id="vp-tabla" class="divide-y divide-white/5"></tbody>
        </table>
      </div>
    </section>`;
  }

  function esqueletoFinanciados() {
    return `
    ${BANNER}
    <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
      <h3 class="font-heading text-lg font-bold">Equipos a pagar</h3>
      <button type="button" onclick="VP.nuevoFinanciado()" class="text-xs font-bold px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500"><i class="fa-solid fa-plus mr-1"></i>Nuevo equipo a pagar</button>
    </div>
    <div id="vp-fin-kpis"></div>
    <div class="flex flex-wrap gap-2 my-4">
      <select id="vp-fin-filtro" onchange="VP.renderFinanciados()" class="rounded-xl p-2.5 bg-slate-800 border border-white/10 text-xs font-bold">
        <option value="deuda">Con deuda</option><option value="vencidos">Vencidos</option><option value="saldados">Saldados</option><option value="todos">Todos</option>
      </select>
      <input id="vp-fin-q" oninput="VP.renderFinanciados()" placeholder="Buscar cliente o equipo..." class="rounded-xl p-2.5 bg-white/10 border border-white/10 text-xs outline-none w-56">
    </div>
    <div id="vp-fin-lista" class="space-y-3"></div>`;
  }

  function esqueletoProveedores() {
    return `
    ${BANNER}
    <section class="${CARD} border-blue-500/30">
      <h3 class="text-sm font-bold text-blue-400 uppercase tracking-wider"><i class="fa-solid fa-truck-field mr-1"></i> <span id="vpr-titulo">Nuevo proveedor</span></h3>
      <input type="hidden" id="vpr-id">
      <div class="grid sm:grid-cols-4 gap-3 mt-3">
        <div>${L('Nombre')}<input id="vpr-nombre" class="${INP}" placeholder="Ej. Juan Importados"></div>
        <div>${L('Teléfono / contacto')}<input id="vpr-tel" class="${INP}"></div>
        <div class="sm:col-span-2">${L('Notas')}<input id="vpr-notas" class="${INP}" placeholder="Ciudad, condiciones, garantía..."></div>
      </div>
      <div class="flex gap-2 mt-3">
        <button type="button" onclick="VP.guardarProveedor()" class="bg-blue-600 hover:bg-blue-500 px-5 py-3 rounded-xl font-extrabold text-sm">Guardar proveedor</button>
        <button type="button" id="vpr-cancel" onclick="VP.limpiarProveedor()" class="hidden bg-slate-700 hover:bg-slate-600 px-4 py-3 rounded-xl text-xs font-bold">Cancelar</button>
      </div>
    </section>
    <section class="mt-8">
      <h3 class="font-heading text-lg font-bold mb-2">Proveedores y qué te dejó cada uno</h3>
      <div class="overflow-x-auto rounded-2xl border border-white/10">
        <table class="w-full text-left text-xs" style="min-width: 720px;">
          <thead class="bg-white/5 text-slate-400 font-bold uppercase"><tr>
            <th class="p-3">Proveedor</th><th class="p-3">Contacto</th><th class="p-3 text-right">Unidades vendidas</th>
            <th class="p-3 text-right">Costo de compra</th><th class="p-3 text-right">Ganancia generada</th><th class="p-3">Última venta</th><th class="p-3 text-right"></th>
          </tr></thead>
          <tbody id="vpr-lista" class="divide-y divide-white/5"></tbody>
        </table>
      </div>
    </section>`;
  }

  // ============================================================
  // VENTAS — formulario
  // ============================================================
  function setOrigen(o) {
    origen = o;
    $('vf-box-catalogo').classList.toggle('hidden', o !== 'catalogo');
    $('vf-box-manual').classList.toggle('hidden', o !== 'manual');
    $('vf-stock-wrap').classList.toggle('hidden', o !== 'catalogo');
    const on = 'px-3 py-2 rounded-lg bg-blue-600 text-white', off = 'px-3 py-2 rounded-lg text-slate-300 hover:bg-white/10';
    $('vf-o-catalogo').className = o === 'catalogo' ? on : off;
    $('vf-o-manual').className = o === 'manual' ? on : off;
    if (o === 'manual') { $('vf-gastos').value = $('vf-gastos').value || '0'; }
    preview();
  }

  function setMetodo(m, mantenerRecargo) {
    metodo = m;
    document.querySelectorAll('.vf-m').forEach(b => {
      const act = b.dataset.m === m;
      b.className = 'vf-m rounded-xl border p-2.5 text-xs font-bold transition ' + (act ? 'bg-blue-600 border-blue-400 text-white' : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10');
    });
    $('vf-p-credito').classList.toggle('hidden', m !== 'credito');
    $('vf-p-cripto').classList.toggle('hidden', m !== 'cripto');
    $('vf-p-fin').classList.toggle('hidden', m !== 'financiado');
    if (!mantenerRecargo) {
      const c = Number($('vf-cuotas').value) || 1;
      $('vf-recargo').value = recargoDefault(m, c);
      $('vf-comision').value = comisionDefault(m, c);
    }
    preview();
  }
  function onCuotas() {
    const c = Number($('vf-cuotas').value) || 1;
    $('vf-recargo').value = recargoDefault('credito', c);
    $('vf-comision').value = comisionDefault('credito', c);
    preview();
  }

  function renderOpcionesProductos() {
    const q = ($('vf-q').value || '').toLowerCase().trim();
    const sel = $('vf-prod'), actual = sel.value;
    const lista = listaProductos().slice().sort((a, b) => (Number(b.stock) > 0) - (Number(a.stock) > 0) || String(a.nombre).localeCompare(String(b.nombre)))
      .filter(p => !q || `${p.nombre} ${p.specs} ${p.imei || ''}`.toLowerCase().includes(q));
    sel.innerHTML = '<option value="">Elegí un producto...</option>' + lista.map(p =>
      `<option value="${esc(p.id)}">${esc(p.nombre)} — ${esc(p.specs || '')}${p.imei ? ' · IMEI …' + esc(p.imei) : ''} (${Number(p.stock) || 0} u.)</option>`).join('');
    if (actual && lista.some(p => String(p.id) === actual)) sel.value = actual;
  }
  const filtrarProductos = renderOpcionesProductos;

  function productoElegido() { const id = $('vf-prod').value; return id ? listaProductos().find(p => String(p.id) === id) : null; }

  function onProducto() {
    const p = productoElegido();
    if (!p) { $('vf-prod-info').textContent = ''; preview(); return; }
    $('vf-precio').value = p.precioDirectoUSD || '';
    $('vf-costo').value = p.costoBaseUSD || '';
    $('vf-gastos').value = regaloCosto();
    $('vf-cant').value = 1;
    const cot = p.tipoCotizacion === 'oficial' && typeof dolarOficial !== 'undefined' ? dolarOficial
      : p.tipoCotizacion === 'tarjeta' && typeof dolarTarjeta !== 'undefined' ? dolarTarjeta : cotHoy();
    $('vf-cot').value = cot;
    const st = Number(p.stock) || 0;
    $('vf-prod-info').innerHTML = `Stock: <b class="${st > 0 ? 'text-emerald-300' : 'text-red-300'}">${st} u.</b> · ${esc(p.condicion || '')} · Batería ${esc(p.bateria || 'N/A')} · Otros gastos precargados con el regalo de accesorios (${fUSD(regaloCosto())}), editable.`;
    preview();
  }

  function proveedorSelectHTML(sel) {
    return '<option value="">— Sin proveedor —</option>' + datos.proveedores.slice().sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map(p => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('');
  }
  function refrescarSelectProveedores() {
    const s = $('vf-prov'); if (!s) return;
    const cur = s.value; s.innerHTML = proveedorSelectHTML(cur); s.value = cur;
  }
  async function proveedorRapido() {
    const nombre = (prompt('Nombre del proveedor:') || '').trim();
    if (!nombre) return;
    const id = uid('p');
    const ok = await mutar(() => datos.proveedores.push({ id, nombre, telefono: '', notas: '' }));
    if (ok) { refrescarSelectProveedores(); $('vf-prov').value = id; toast('Proveedor agregado ✅'); }
  }

  function leerForm() {
    const p = origen === 'catalogo' ? productoElegido() : null;
    const v = {
      origen, productoId: p ? p.id : null,
      nombre: p ? p.nombre : $('vf-nombre').value.trim(),
      specs: p ? (p.specs || '') : $('vf-specs').value.trim(),
      imei: p ? (p.imei || '') : $('vf-imei').value.trim(),
      cantidad: Math.max(1, parseInt($('vf-cant').value, 10) || 1),
      precioUSD: num($('vf-precio').value), costoUSD: num($('vf-costo').value), gastosUSD: num($('vf-gastos').value),
      cot: num($('vf-cot').value), metodo,
      cuotas: metodo === 'credito' ? Number($('vf-cuotas').value) || 1 : 0,
      recargoPct: num($('vf-recargo').value), comisionPct: num($('vf-comision').value)
    };
    return { v, p, c: calcularVenta(v) };
  }

  function entregaUSD(v) {
    const m = num($('vf-ent-monto').value);
    if (!m) return 0;
    return $('vf-ent-moneda').value === 'USD' ? m : (v.cot > 0 ? m / v.cot : 0);
  }

  function preview() {
    const box = $('vf-preview'); if (!box) return;
    const { v, c } = leerForm();
    const esARS = METODOS[metodo].moneda === 'ARS';
    const principal = esARS ? fARS(c.brutoARS) : fUSD(c.brutoUSD);
    const secundario = esARS ? '≈ ' + fUSD(c.brutoUSD) : '≈ ' + fARS(c.brutoARS);
    const fila = (t, val, cls = '') => `<div class="flex justify-between gap-3 text-xs"><span class="text-slate-400">${t}</span><b class="${cls}">${val}</b></div>`;
    let extra = '';
    if (metodo === 'credito') extra = `<div class="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-center"><p class="text-[11px] text-blue-300">Total final en ${c.cuotas} ${c.cuotas === 1 ? 'pago' : 'cuotas'}</p><p class="font-heading font-black text-lg">${c.cuotas} × ${fARS(c.valorCuotaARS)}</p></div>`;
    if (metodo === 'debito') extra = `<p class="text-[11px] text-slate-400 text-center">Valor final con recargo de débito (${v.recargoPct}%)</p>`;
    if (metodo === 'financiado') {
      const ent = entregaUSD(v), saldo = Math.max(0, c.brutoUSD - ent), n = parseInt($('vf-fin-n').value, 10) || 0;
      extra = `<div class="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-1">${fila('Entrega inicial', fUSD(ent))}${fila('Saldo a pagar', fUSD(saldo), 'text-amber-300')}${n ? fila('Cuota estimada', fUSD(saldo / n) + ' × ' + n) : ''}</div>`;
    }
    box.innerHTML = `
      <div class="text-center">
        <p class="text-[11px] text-slate-400">${metodo === 'financiado' ? 'Precio total a pagar' : 'El cliente paga'}</p>
        <p class="font-heading text-2xl font-black text-white">${principal}</p>
        <p class="text-xs text-slate-400">${secundario}</p>
      </div>
      ${extra}
      <div class="space-y-1.5 pt-2 border-t border-white/10">
        ${fila('Precio base', fUSD(c.baseUSD))}
        ${fila('Recargo / descuento', (c.recargoUSD >= 0 ? '+' : '−') + fUSD(Math.abs(c.recargoUSD)))}
        ${fila('Bruto', fUSD(c.brutoUSD), 'text-white')}
        ${fila('Retiene el medio de pago', '−' + fUSD(c.comisionUSD))}
        ${fila('Neto', fUSD(c.netoUSD), 'text-blue-300')}
        ${fila('Costo + gastos', '−' + fUSD(c.costoTotalUSD))}
        <div class="flex justify-between items-center pt-2 border-t border-white/10"><span class="text-sm font-bold">Te queda</span><b class="font-heading text-lg ${c.gananciaUSD >= 0 ? 'text-emerald-300' : 'text-red-400'}">${fUSD(c.gananciaUSD)}</b></div>
        <p class="text-right text-[11px] text-slate-500">${fARS(c.gananciaUSD * (v.cot || 0))} al cambio cargado</p>
      </div>`;
  }

  function resetForm() {
    ['vf-q', 'vf-nombre', 'vf-specs', 'vf-imei', 'vf-precio', 'vf-costo', 'vf-cliente', 'vf-tel', 'vf-notas', 'vf-ent-monto', 'vf-fin-n', 'vf-fin-venc', 'vf-cripto-nota'].forEach(id => { if ($(id)) $(id).value = ''; });
    $('vf-cant').value = 1; $('vf-gastos').value = '0'; $('vf-prod').value = ''; $('vf-prod-info').textContent = '';
    $('vf-fecha').value = hoyISO(); $('vf-cot').value = cotHoy(); $('vf-prov').value = '';
    renderOpcionesProductos(); setMetodo('efectivo');
  }

  async function registrar() {
    const { v, p, c } = leerForm();
    if (origen === 'catalogo' && !p) return toast('Elegí un producto del catálogo');
    if (origen === 'manual' && !v.nombre) return toast('Falta el nombre del artículo');
    if (!(v.precioUSD > 0)) return toast('Falta el precio de venta');
    if (!(v.cot > 0)) return toast('Falta la cotización USD→ARS');
    const cliente = $('vf-cliente').value.trim();
    if (metodo === 'financiado' && !cliente) return toast('Para un equipo a pagar necesito el nombre del cliente');
    const fecha = $('vf-fecha').value || hoyISO();

    const prov = datos.proveedores.find(x => x.id === $('vf-prov').value);
    const venta = {
      id: uid('v'), creada: Date.now(), fecha, origen: v.origen, productoId: v.productoId,
      nombre: v.nombre, specs: v.specs, imei: v.imei, cantidad: c.cant,
      proveedorId: prov ? prov.id : '', proveedorNombre: prov ? prov.nombre : '',
      cliente, telefono: $('vf-tel').value.trim(), notas: $('vf-notas').value.trim(),
      precioUSD: v.precioUSD, costoUSD: v.costoUSD, gastosUSD: v.gastosUSD, cot: v.cot,
      metodo, cuotas: c.cuotas, recargoPct: v.recargoPct, comisionPct: v.comisionPct,
      cripto: metodo === 'cripto' ? { moneda: $('vf-cripto-moneda').value, nota: $('vf-cripto-nota').value.trim() } : null,
      brutoUSD: c.brutoUSD, brutoARS: c.brutoARS, netoUSD: c.netoUSD, costoTotalUSD: c.costoTotalUSD,
      gananciaUSD: c.gananciaUSD, valorCuotaARS: c.valorCuotaARS,
      condicion: p ? (p.condicion || '') : '', bateria: p ? (p.bateria || '') : '', garantia: p ? (p.garantia || '') : '',
      nro: datos.ventas.reduce((mx, x) => Math.max(mx, x.nro || 0), 0) + 1,
      descontoStock: 0, financiado: null
    };

    if (metodo === 'financiado') {
      const ent = entregaUSD(v), entMonto = num($('vf-ent-monto').value);
      if (ent > c.brutoUSD + 0.005 && !confirm('La entrega inicial es mayor al precio total. ¿Continuar igual?')) return;
      const pagos = [];
      if (ent > 0) {
        const mon = $('vf-ent-moneda').value;
        pagos.push({ id: uid('g'), fecha, monto: entMonto, moneda: mon, cot: v.cot, usd: ent, metodo: mon === 'USD' ? 'usd' : 'efectivo', nota: 'Entrega inicial', esEntrega: true });
      }
      venta.financiado = { cuotasPactadas: parseInt($('vf-fin-n').value, 10) || 0, primerVencimiento: $('vf-fin-venc').value || '', pagos };
    }

    const stockOk = origen === 'catalogo' && $('vf-stock').checked && p;
    const ok = await mutar(() => {
      if (stockOk) venta.descontoStock = c.cant;
      datos.ventas.push(venta);
    });
    if (!ok) return;

    if (stockOk) await ajustarStock(p.id, -c.cant);
    toast(metodo === 'financiado' ? 'Venta registrada ✅ — seguila en la pestaña "A pagar"' : 'Venta registrada ✅');
    resetForm();
  }

  // Ajusta stock en el catálogo (usa las funciones del admin.html)
  async function ajustarStock(productoId, delta) {
    const prod = listaProductos().find(x => String(x.id) === String(productoId));
    if (!prod) return;
    prod.stock = Math.max(0, (Number(prod.stock) || 0) + delta);
    if (prod.stock === 0) prod.disponibilidad = 'Sin stock';
    else if (prod.disponibilidad === 'Sin stock') prod.disponibilidad = 'En Stock';
    if (typeof guardarProductosRemotos === 'function') await guardarProductosRemotos();
    if (typeof renderAdminTable === 'function') renderAdminTable();
    renderOpcionesProductos();
  }

  // ============================================================
  // VENTAS — resumen y tabla
  // ============================================================
  function rangoPeriodo() {
    const per = $('vp-periodo').value, hoy = hoyISO(), d = new Date();
    const iso = x => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
    $('vp-rango').classList.toggle('hidden', per !== 'rango');
    if (per === 'todo') return null;
    if (per === 'hoy') return [hoy, hoy];
    if (per === '7d') { const a = new Date(d); a.setDate(a.getDate() - 6); return [iso(a), hoy]; }
    if (per === 'mes') return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), iso(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
    if (per === 'mesant') return [iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), iso(new Date(d.getFullYear(), d.getMonth(), 0))];
    if (per === 'anio') return [d.getFullYear() + '-01-01', d.getFullYear() + '-12-31'];
    return [$('vp-desde').value || '0000-01-01', $('vp-hasta').value || '9999-12-31'];
  }
  function ventasFiltradas() {
    const r = rangoPeriodo(), q = ($('vp-q').value || '').toLowerCase().trim(), fm = $('vp-fmedio').value;
    return datos.ventas.filter(v => (!r || (v.fecha >= r[0] && v.fecha <= r[1])) && (!fm || v.metodo === fm) &&
      (!q || `${v.nombre} ${v.specs} ${v.cliente} ${v.proveedorNombre} ${v.imei}`.toLowerCase().includes(q)))
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creada - a.creada);
  }

  function renderVentas() {
    if (!$('vp-kpis')) return;
    const list = ventasFiltradas(), s = resumen(list);
    const margen = s.brutoUSD ? (s.gananciaUSD / s.brutoUSD * 100) : 0;
    const big = (titulo, sub, usd, ars, cls, ic) => `
      <div class="${CARD} ${cls}">
        <div class="flex items-center justify-between"><p class="text-xs font-bold text-slate-300">${titulo}</p><i class="fa-solid ${ic} text-slate-500"></i></div>
        <p class="font-heading text-2xl sm:text-3xl font-black mt-1">${fUSD(usd)}</p>
        <p class="text-xs text-slate-400">${fARS(ars)}</p>
        <p class="text-[11px] text-slate-500 mt-2">${sub}</p>
      </div>`;
    const mini = (t, val, cls = '') => `<div class="bg-white/5 rounded-xl border border-white/10 p-3"><p class="text-[11px] text-slate-400">${t}</p><p class="font-bold text-sm mt-0.5 ${cls}">${val}</p></div>`;
    $('vp-kpis').innerHTML = `
      <div class="grid md:grid-cols-3 gap-3">
        ${big('Venta bruta', 'Lo que pagan los clientes, con recargos de tarjeta incluidos.', s.brutoUSD, s.brutoARS, '', 'fa-sack-dollar')}
        ${big('Neto', 'Bruto menos lo que retienen los medios de pago.', s.netoUSD, s.netoARS, 'border-blue-500/30', 'fa-scale-balanced')}
        ${big('Te queda', `Neto menos costo y gastos. Margen ${margen.toFixed(1)}% sobre la venta.`, s.gananciaUSD, s.gananciaARS, 'border-emerald-500/40 ' + (s.gananciaUSD < 0 ? 'text-red-300' : ''), 'fa-piggy-bank')}
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
        ${mini('Ventas', s.n)}
        ${mini('Costo de mercadería y gastos', fUSD(s.costoUSD))}
        ${mini('Ya cobrado', fUSD(s.cobradoUSD), 'text-emerald-300')}
        ${mini('Falta cobrar (equipos a pagar)', fUSD(s.porCobrarUSD), s.porCobrarUSD > 0.005 ? 'text-amber-300' : '')}
      </div>`;

    const porMedio = {};
    list.forEach(v => { const o = porMedio[v.metodo] || (porMedio[v.metodo] = { n: 0, usd: 0 }); o.n++; o.usd += v.brutoUSD; });
    const max = Math.max(1, ...Object.values(porMedio).map(o => o.usd));
    $('vp-medios').innerHTML = `<h4 class="text-sm font-bold mb-3">Ventas por medio de pago</h4>` +
      (Object.keys(porMedio).length ? Object.entries(porMedio).sort((a, b) => b[1].usd - a[1].usd).map(([k, o]) => `
        <div class="flex items-center gap-3 text-xs mb-2">
          <span class="w-28 shrink-0 font-bold"><i class="fa-solid ${METODOS[k] ? METODOS[k].ic : 'fa-circle'} mr-1 text-slate-400"></i>${METODOS[k] ? METODOS[k].label : esc(k)}</span>
          <div class="flex-1 h-2.5 bg-white/5 rounded-full overflow-hidden"><div class="h-full bg-blue-500 rounded-full" style="width:${(o.usd / max * 100).toFixed(1)}%"></div></div>
          <span class="w-40 shrink-0 text-right text-slate-300">${fUSD(o.usd)} <span class="text-slate-500">· ${o.n} vta${o.n === 1 ? '' : 's'}</span></span>
        </div>`).join('') : '<p class="text-xs text-slate-500">No hay ventas en este período.</p>');

    $('vp-tabla').innerHTML = list.map(v => {
      const m = METODOS[v.metodo] || { label: v.metodo, ic: 'fa-circle' };
      let det = '';
      if (v.metodo === 'credito') det = `<div class="text-slate-400">${v.cuotas} × ${fARS(v.valorCuotaARS)}</div>`;
      if (v.metodo === 'cripto' && v.cripto) det = `<div class="text-slate-400">${esc(v.cripto.moneda)}</div>`;
      if (v.financiado) { const d = debeUSD(v); det = `<div class="${d > 0.005 ? 'text-amber-300' : 'text-emerald-300'} font-bold">${d > 0.005 ? 'Debe ' + fUSD(d) : 'Saldado'}</div>`; }
      const esARS = m.moneda === 'ARS';
      return `<tr class="hover:bg-white/5">
        <td class="p-3 whitespace-nowrap text-slate-300">${fmtF(v.fecha)}</td>
        <td class="p-3"><b>${esc(v.nombre)}</b>${v.cantidad > 1 ? ` <span class="text-slate-400">×${v.cantidad}</span>` : ''}
          <div class="text-slate-400">${esc(v.specs || '')}${v.imei ? ' · IMEI …' + esc(String(v.imei).slice(-4)) : ''}</div>
          <div class="text-slate-500">${v.cliente ? '<i class="fa-regular fa-user mr-1"></i>' + esc(v.cliente) : ''}${v.proveedorNombre ? ' <i class="fa-solid fa-truck-field ml-2 mr-1"></i>' + esc(v.proveedorNombre) : ''}</div></td>
        <td class="p-3"><span class="px-2 py-0.5 rounded-full bg-white/10 font-bold"><i class="fa-solid ${m.ic} mr-1"></i>${m.label}</span>${det}</td>
        <td class="p-3 text-right font-bold">${esARS ? fARS(v.brutoARS) : fUSD(v.brutoUSD)}<div class="text-[10px] font-normal text-slate-500">${esARS ? fUSD(v.brutoUSD) : fARS(v.brutoARS)}</div></td>
        <td class="p-3 text-right text-blue-300 font-bold">${fUSD(v.netoUSD)}</td>
        <td class="p-3 text-right font-bold ${v.gananciaUSD >= 0 ? 'text-emerald-300' : 'text-red-400'}">${fUSD(v.gananciaUSD)}</td>
        <td class="p-3 text-right whitespace-nowrap space-x-2">
          <button type="button" onclick="VP.abrirRecibo('${v.id}')" title="Recibo" class="text-emerald-400"><i class="fa-solid fa-receipt"></i></button>
          <button type="button" onclick="VP.verVenta('${v.id}')" title="Ver detalle" class="text-blue-400"><i class="fa-solid fa-eye"></i></button>
          <button type="button" onclick="VP.borrarVenta('${v.id}')" title="Eliminar" class="text-red-400"><i class="fa-solid fa-trash"></i></button>
        </td></tr>`;
    }).join('') || '<tr><td colspan="7" class="p-6 text-center text-slate-500">No hay ventas para mostrar con estos filtros.</td></tr>';
  }

  async function borrarVenta(id) {
    const v = datos.ventas.find(x => x.id === id); if (!v) return;
    if (!confirm(`¿Eliminar la venta de "${v.nombre}"?` + (v.financiado ? '\nSe borrarán también sus pagos registrados.' : ''))) return;
    const devolver = v.descontoStock > 0 && v.productoId != null && listaProductos().some(p => String(p.id) === String(v.productoId)) &&
      confirm(`¿Devolver ${v.descontoStock} unidad(es) al stock del catálogo?`);
    const ok = await mutar(() => { datos.ventas = datos.ventas.filter(x => x.id !== id); });
    if (ok) { if (devolver) await ajustarStock(v.productoId, v.descontoStock); toast('Venta eliminada'); cerrarModal(); }
  }

  function exportarCSV() {
    const list = ventasFiltradas();
    if (!list.length) return toast('No hay ventas para exportar');
    const cols = ['fecha', 'articulo', 'detalle', 'imei', 'cantidad', 'cliente', 'proveedor', 'medio_pago', 'cuotas', 'cotizacion', 'precio_base_usd', 'recargo_pct', 'bruto_usd', 'bruto_ars', 'neto_usd', 'costo_total_usd', 'ganancia_usd', 'cobrado_usd', 'debe_usd'];
    const q = x => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"';
    const rows = list.map(v => [v.fecha, v.nombre, v.specs, v.imei, v.cantidad, v.cliente, v.proveedorNombre, (METODOS[v.metodo] || {}).label || v.metodo, v.cuotas || '', v.cot,
      (v.precioUSD * v.cantidad).toFixed(2), v.recargoPct, v.brutoUSD.toFixed(2), Math.round(v.brutoARS), v.netoUSD.toFixed(2), v.costoTotalUSD.toFixed(2), v.gananciaUSD.toFixed(2),
      pagadoUSD(v).toFixed(2), debeUSD(v).toFixed(2)].map(q).join(';'));
    const url = URL.createObjectURL(new Blob(['\uFEFF' + [cols.join(';'), ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'ventas-matos-' + hoyISO() + '.csv'; a.click(); URL.revokeObjectURL(url);
  }

  // ============================================================
  // MODAL
  // ============================================================
  function modal(html, ancho = 'max-w-lg') { const m = $('vp-modal'); m.innerHTML = `<div class="w-full ${ancho} max-h-[90vh] overflow-y-auto bg-slate-900 border border-white/10 rounded-2xl p-5 shadow-2xl">${html}</div>`; m.classList.remove('hidden'); m.classList.add('flex'); }
  function cerrarModal() { rc = null; const m = $('vp-modal'); if (m) { m.classList.add('hidden'); m.classList.remove('flex'); m.innerHTML = ''; } }

  function verVenta(id) {
    const v = datos.ventas.find(x => x.id === id); if (!v) return;
    const m = METODOS[v.metodo] || { label: v.metodo };
    const f = (t, val) => `<div class="flex justify-between gap-4 py-1.5 border-b border-white/5 text-xs"><span class="text-slate-400">${t}</span><span class="font-bold text-right">${val}</span></div>`;
    modal(`
      <div class="flex justify-between items-start gap-3 mb-3"><div><h3 class="font-heading font-black text-lg">${esc(v.nombre)}</h3><p class="text-xs text-slate-400">${esc(v.specs || '')}</p></div>
      <button type="button" onclick="VP.cerrarModal()" class="text-slate-400 text-xl leading-none">×</button></div>
      ${f('Fecha', fmtF(v.fecha))}${f('Origen', v.origen === 'catalogo' ? 'Catálogo' : 'Carga manual')}${f('Cantidad', v.cantidad)}
      ${v.imei ? f('IMEI', esc(v.imei)) : ''}${f('Cliente', esc(v.cliente || '—') + (v.telefono ? ' · ' + esc(v.telefono) : ''))}
      ${f('Proveedor', esc(v.proveedorNombre || '—'))}
      ${f('Medio de pago', m.label + (v.metodo === 'credito' ? ` — ${v.cuotas} × ${fARS(v.valorCuotaARS)}` : '') + (v.cripto ? ' — ' + esc(v.cripto.moneda + (v.cripto.nota ? ' ' + v.cripto.nota : '')) : ''))}
      ${f('Cotización usada', fARS(v.cot))}
      ${f('Precio base', fUSD(v.precioUSD * v.cantidad))}${f('Recargo / descuento', v.recargoPct + '%')}
      ${f('Bruto', `${fUSD(v.brutoUSD)} · ${fARS(v.brutoARS)}`)}${f('Retenido por medio de pago', v.comisionPct + '%')}
      ${f('Neto', fUSD(v.netoUSD))}${f('Costo + gastos', fUSD(v.costoTotalUSD))}
      ${f('Te queda', `<span class="${v.gananciaUSD >= 0 ? 'text-emerald-300' : 'text-red-400'}">${fUSD(v.gananciaUSD)}</span>`)}
      ${v.notas ? f('Notas', esc(v.notas)) : ''}
      <button type="button" onclick="VP.abrirRecibo('${v.id}')" class="mt-4 w-full bg-emerald-600 hover:bg-emerald-500 py-3 rounded-xl font-bold text-sm"><i class="fa-solid fa-receipt mr-1"></i>Recibo de compra</button>
      ${v.financiado ? `<button type="button" onclick="VP.cerrarModal();VP.tab('financiados')" class="mt-4 w-full bg-amber-600 hover:bg-amber-500 py-3 rounded-xl font-bold text-sm">Ver seguimiento de pagos</button>` : ''}`);
  }

  // ============================================================
  // EQUIPOS A PAGAR
  // ============================================================
  function nuevoFinanciado() { tab('ventas'); setMetodo('financiado'); $('vf-cliente').focus(); }

  function renderFinanciados() {
    if (!$('vp-fin-lista')) return;
    const hoy = hoyISO();
    const todos = datos.ventas.filter(v => v.financiado).map(v => ({ v, e: estadoPlan(v, hoy) }));
    const deuda = todos.filter(x => !x.e.saldado);
    const sum = (arr, k) => arr.reduce((s, x) => s + x.e[k], 0);
    const mini = (t, val, cls = '') => `<div class="bg-white/5 rounded-xl border border-white/10 p-3"><p class="text-[11px] text-slate-400">${t}</p><p class="font-heading font-black text-lg mt-0.5 ${cls}">${val}</p></div>`;
    const debeTot = sum(deuda, 'debe');
    $('vp-fin-kpis').innerHTML = `<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      ${mini('Me deben', fUSD(debeTot), 'text-amber-300')}
      ${mini('Equivale a (cotización de hoy)', fARS(debeTot * cotHoy()))}
      ${mini('Ya cobrado de estos equipos', fUSD(sum(todos, 'pagado')), 'text-emerald-300')}
      ${mini('Cuotas vencidas', deuda.filter(x => x.e.vencido).length, deuda.some(x => x.e.vencido) ? 'text-red-400' : '')}
    </div>`;

    const filtro = $('vp-fin-filtro').value, q = ($('vp-fin-q').value || '').toLowerCase().trim();
    const vista = todos.filter(({ v, e }) =>
      (filtro === 'todos' || (filtro === 'deuda' && !e.saldado) || (filtro === 'vencidos' && e.vencido) || (filtro === 'saldados' && e.saldado)) &&
      (!q || `${v.cliente} ${v.nombre} ${v.specs}`.toLowerCase().includes(q)))
      .sort((a, b) => (b.e.vencido - a.e.vencido) || (b.e.diasVenc - a.e.diasVenc) || b.v.fecha.localeCompare(a.v.fecha));

    $('vp-fin-lista').innerHTML = vista.map(({ v, e }) => {
      const pct = v.brutoUSD ? Math.min(100, e.pagado / v.brutoUSD * 100) : 100;
      let chip = '';
      if (e.saldado) chip = '<span class="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-bold">Saldado</span>';
      else if (e.vencido) chip = `<span class="px-2 py-0.5 rounded-full bg-red-500/15 text-red-300 font-bold">Vencido hace ${e.diasVenc} día${e.diasVenc === 1 ? '' : 's'}</span>`;
      else if (e.proxVenc) chip = `<span class="px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 font-bold">Próx. venc. ${fmtF(e.proxVenc)}</span>`;
      else chip = '<span class="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 font-bold">Con saldo</span>';
      const abierto = !!planAbierto[v.id];
      const pagos = v.financiado.pagos.slice().sort((a, b) => b.fecha.localeCompare(a.fecha));
      const hist = abierto ? `
        <div class="mt-3 overflow-x-auto rounded-xl border border-white/10"><table class="w-full text-left text-xs" style="min-width:520px">
          <thead class="bg-white/5 text-slate-400 font-bold"><tr><th class="p-2">Fecha</th><th class="p-2">Medio</th><th class="p-2 text-right">Monto</th><th class="p-2 text-right">En USD</th><th class="p-2">Nota</th><th class="p-2"></th></tr></thead>
          <tbody class="divide-y divide-white/5">${pagos.map(p => `<tr>
            <td class="p-2">${fmtF(p.fecha)}</td><td class="p-2">${(METODOS[p.metodo] || {}).label || esc(p.metodo)}</td>
            <td class="p-2 text-right">${p.moneda === 'USD' ? fUSD(p.monto) : fARS(p.monto) + `<span class="block text-[10px] text-slate-500">a ${fARS(p.cot)}</span>`}</td>
            <td class="p-2 text-right font-bold text-emerald-300">${fUSD(p.usd)}</td><td class="p-2 text-slate-400">${esc(p.nota || '')}</td>
            <td class="p-2 text-right"><button type="button" onclick="VP.borrarPago('${v.id}','${p.id}')" class="text-red-400" title="Eliminar pago"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('') ||
            '<tr><td colspan="6" class="p-3 text-center text-slate-500">Todavía no hay pagos registrados.</td></tr>'}</tbody></table></div>` : '';
      const wa = v.telefono ? `<a href="${waLink(v, e)}" target="_blank" rel="noopener" class="text-xs font-bold px-3 py-2 rounded-lg bg-emerald-700/70 hover:bg-emerald-600"><i class="fa-brands fa-whatsapp mr-1"></i>Recordar</a>` : '';
      return `<div class="${CARD} ${e.vencido ? 'border-red-500/40' : ''}">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0"><p class="font-heading font-black text-base">${esc(v.cliente)}</p>
            <p class="text-xs text-slate-300">${esc(v.nombre)} <span class="text-slate-500">${esc(v.specs || '')}${v.imei ? ' · IMEI …' + esc(String(v.imei).slice(-4)) : ''}</span></p>
            <p class="text-[11px] text-slate-500 mt-0.5">Vendido el ${fmtF(v.fecha)}${v.telefono ? ' · ' + esc(v.telefono) : ''}${v.proveedorNombre ? ' · Prov: ' + esc(v.proveedorNombre) : ''}</p></div>
          <div class="text-xs">${chip}</div>
        </div>
        <div class="grid grid-cols-3 gap-3 mt-3 text-center">
          <div><p class="text-[11px] text-slate-400">Total</p><p class="font-bold">${fUSD(e.total)}</p></div>
          <div><p class="text-[11px] text-slate-400">Pagó</p><p class="font-bold text-emerald-300">${fUSD(e.pagado)}</p></div>
          <div><p class="text-[11px] text-slate-400">Debe</p><p class="font-bold ${e.saldado ? 'text-emerald-300' : 'text-amber-300'}">${fUSD(e.debe)}</p><p class="text-[10px] text-slate-500">${e.saldado ? '' : '≈ ' + fARS(e.debe * cotHoy())}</p></div>
        </div>
        <div class="h-2 bg-white/5 rounded-full overflow-hidden mt-3"><div class="h-full ${e.saldado ? 'bg-emerald-500' : 'bg-amber-500'} rounded-full" style="width:${pct.toFixed(1)}%"></div></div>
        ${v.financiado.cuotasPactadas && !e.saldado ? `<p class="text-[11px] text-slate-500 mt-1">Plan de ${v.financiado.cuotasPactadas} cuotas de ~${fUSD(e.valorCuotaUSD)} · cubiertas: ${e.cuotasCubiertas}</p>` : ''}
        <div class="flex flex-wrap gap-2 mt-3">
          ${e.saldado ? '' : `<button type="button" onclick="VP.abrirPago('${v.id}')" class="text-xs font-bold px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500"><i class="fa-solid fa-plus mr-1"></i>Registrar pago</button>`}
          <button type="button" onclick="VP.togglePlan('${v.id}')" class="text-xs font-bold px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15"><i class="fa-solid fa-list mr-1"></i>${abierto ? 'Ocultar' : 'Ver'} pagos (${pagos.length})</button>
          <button type="button" onclick="VP.abrirRecibo('${v.id}')" class="text-xs font-bold px-3 py-2 rounded-lg bg-emerald-700/70 hover:bg-emerald-600"><i class="fa-solid fa-receipt mr-1"></i>Recibo</button>
          ${e.saldado ? '' : wa}
          <button type="button" onclick="VP.borrarVenta('${v.id}')" class="text-xs font-bold px-3 py-2 rounded-lg bg-white/5 hover:bg-red-600/60 text-slate-400 ml-auto" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
        </div>${hist}</div>`;
    }).join('') || '<p class="text-center text-slate-500 text-sm p-8 border border-dashed border-white/10 rounded-2xl">No hay equipos para mostrar con este filtro.</p>';
  }
  function togglePlan(id) { planAbierto[id] = !planAbierto[id]; renderFinanciados(); }

  function waLink(v, e) {
    let d = String(v.telefono || '').replace(/\D/g, '').replace(/^0+/, '');
    if (!d.startsWith('54')) d = '549' + d;
    const txt = `Hola ${v.cliente}! Te escribo de Matos iPhone Rosario por tu ${v.nombre}. ` +
      `Tu saldo pendiente es de ${fUSD(e.debe)} (aprox. ${fARS(e.debe * cotHoy())} al dólar de hoy).` +
      (e.proxVenc ? ` Tu próxima cuota vence el ${fmtF(e.proxVenc)}.` : '') + ' ¡Gracias!';
    return `https://wa.me/${d}?text=${encodeURIComponent(txt)}`;
  }

  // --- registrar pago ---
  function abrirPago(id) {
    const v = datos.ventas.find(x => x.id === id); if (!v) return;
    const e = estadoPlan(v);
    modal(`
      <div class="flex justify-between items-start gap-3 mb-3"><div><h3 class="font-heading font-black text-lg">Registrar pago</h3>
        <p class="text-xs text-slate-400">${esc(v.cliente)} · ${esc(v.nombre)} · debe <b class="text-amber-300">${fUSD(e.debe)}</b></p></div>
        <button type="button" onclick="VP.cerrarModal()" class="text-slate-400 text-xl leading-none">×</button></div>
      <input type="hidden" id="pg-venta" value="${v.id}">
      <div class="grid grid-cols-2 gap-3">
        <div>${L('Fecha del pago')}<input id="pg-fecha" type="date" value="${hoyISO()}" class="${INP}"></div>
        <div>${L('Medio')}<select id="pg-metodo" class="${SEL}"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="usd">USD (billete)</option><option value="debito">Débito</option><option value="credito">Crédito</option><option value="cripto">Cripto</option></select></div>
        <div>${L('Monto recibido')}<input id="pg-monto" inputmode="decimal" oninput="VP.previewPago()" class="${INP} font-bold"></div>
        <div>${L('Moneda')}<select id="pg-moneda" onchange="VP.previewPago()" class="${SEL}"><option value="USD">USD</option><option value="ARS">ARS</option></select></div>
        <div id="pg-cot-wrap" class="hidden col-span-2">${L('Cotización USD→ARS del día')}<input id="pg-cot" inputmode="decimal" value="${cotHoy()}" oninput="VP.previewPago()" class="${INP}"></div>
        <div class="col-span-2">${L('Nota (opcional)')}<input id="pg-nota" placeholder="Ej. cuota 2 de 4" class="${INP}"></div>
      </div>
      <p id="pg-prev" class="text-xs text-slate-300 mt-3"></p>
      <button type="button" onclick="VP.guardarPago()" class="mt-4 w-full bg-blue-600 hover:bg-blue-500 py-3 rounded-xl font-extrabold text-sm">Guardar pago</button>`);
    previewPago();
  }
  function lecturaPago() {
    const v = datos.ventas.find(x => x.id === $('pg-venta').value);
    const monto = num($('pg-monto').value), mon = $('pg-moneda').value, cot = num($('pg-cot').value);
    const usd = mon === 'USD' ? monto : (cot > 0 ? monto / cot : 0);
    return { v, monto, mon, cot, usd };
  }
  function previewPago() {
    $('pg-cot-wrap').classList.toggle('hidden', $('pg-moneda').value !== 'ARS');
    const { v, monto, mon, usd } = lecturaPago(); if (!v) return;
    const nuevo = Math.max(0, estadoPlan(v).debe - usd);
    $('pg-prev').innerHTML = monto ? `${mon === 'ARS' ? `Equivale a <b>${fUSD(usd)}</b>. ` : ''}Después de este pago te quedarían debiendo <b class="${nuevo < 0.005 ? 'text-emerald-300' : 'text-amber-300'}">${nuevo < 0.005 ? 'nada (saldado)' : fUSD(nuevo)}</b>.` : '';
  }
  async function guardarPago() {
    const { v, monto, mon, cot, usd } = lecturaPago(); if (!v) return;
    if (!(monto > 0)) return toast('Ingresá el monto recibido');
    if (mon === 'ARS' && !(cot > 0)) return toast('Falta la cotización del día');
    if (usd > estadoPlan(v).debe + 0.01 && !confirm('El pago es mayor a lo que debe. ¿Registrarlo igual?')) return;
    const pago = { id: uid('g'), fecha: $('pg-fecha').value || hoyISO(), monto, moneda: mon, cot: mon === 'ARS' ? cot : 0, usd, metodo: $('pg-metodo').value, nota: $('pg-nota').value.trim(), esEntrega: false };
    const ok = await mutar(() => { datos.ventas.find(x => x.id === v.id).financiado.pagos.push(pago); });
    if (ok) { cerrarModal(); toast('Pago registrado ✅'); }
  }
  async function borrarPago(ventaId, pagoId) {
    if (!confirm('¿Eliminar este pago?')) return;
    const ok = await mutar(() => { const f = datos.ventas.find(x => x.id === ventaId).financiado; f.pagos = f.pagos.filter(p => p.id !== pagoId); });
    if (ok) toast('Pago eliminado');
  }

  // ============================================================
  // PROVEEDORES
  // ============================================================
  function renderProveedores() {
    if (!$('vpr-lista')) return;
    const stats = {};
    datos.ventas.forEach(v => {
      const k = v.proveedorId || '';
      const s = stats[k] || (stats[k] = { u: 0, costo: 0, gan: 0, ult: '' });
      s.u += v.cantidad; s.costo += v.costoTotalUSD; s.gan += v.gananciaUSD; if (v.fecha > s.ult) s.ult = v.fecha;
    });
    const fila = (p, s) => `<tr class="hover:bg-white/5">
      <td class="p-3"><b>${esc(p.nombre)}</b>${p.notas ? `<div class="text-slate-400">${esc(p.notas)}</div>` : ''}</td>
      <td class="p-3 text-slate-300">${esc(p.telefono || '—')}</td>
      <td class="p-3 text-right font-bold">${s.u}</td><td class="p-3 text-right">${fUSD(s.costo)}</td>
      <td class="p-3 text-right font-bold ${s.gan >= 0 ? 'text-emerald-300' : 'text-red-400'}">${fUSD(s.gan)}</td>
      <td class="p-3 text-slate-400">${s.ult ? fmtF(s.ult) : '—'}</td>
      <td class="p-3 text-right whitespace-nowrap space-x-2">${p.id ? `
        <button type="button" onclick="VP.editarProveedor('${p.id}')" class="text-blue-400"><i class="fa-solid fa-pen"></i></button>
        <button type="button" onclick="VP.borrarProveedor('${p.id}')" class="text-red-400"><i class="fa-solid fa-trash"></i></button>` : ''}</td></tr>`;
    const vacio = { u: 0, costo: 0, gan: 0, ult: '' };
    let html = datos.proveedores.slice().sort((a, b) => (stats[b.id] || vacio).u - (stats[a.id] || vacio).u || a.nombre.localeCompare(b.nombre)).map(p => fila(p, stats[p.id] || vacio)).join('');
    if (stats['']) html += fila({ nombre: 'Sin proveedor asignado', telefono: '', notas: '', id: '' }, stats['']);
    $('vpr-lista').innerHTML = html || '<tr><td colspan="7" class="p-6 text-center text-slate-500">Todavía no cargaste proveedores.</td></tr>';
  }
  function limpiarProveedor() {
    ['vpr-id', 'vpr-nombre', 'vpr-tel', 'vpr-notas'].forEach(id => $(id).value = '');
    $('vpr-titulo').textContent = 'Nuevo proveedor'; $('vpr-cancel').classList.add('hidden');
  }
  function editarProveedor(id) {
    const p = datos.proveedores.find(x => x.id === id); if (!p) return;
    $('vpr-id').value = p.id; $('vpr-nombre').value = p.nombre; $('vpr-tel').value = p.telefono || ''; $('vpr-notas').value = p.notas || '';
    $('vpr-titulo').textContent = 'Editar proveedor'; $('vpr-cancel').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function guardarProveedor() {
    const nombre = $('vpr-nombre').value.trim(), id = $('vpr-id').value;
    if (!nombre) return toast('Falta el nombre del proveedor');
    const datosP = { nombre, telefono: $('vpr-tel').value.trim(), notas: $('vpr-notas').value.trim() };
    const ok = await mutar(() => {
      if (id) {
        Object.assign(datos.proveedores.find(x => x.id === id), datosP);
        datos.ventas.forEach(v => { if (v.proveedorId === id) v.proveedorNombre = nombre; });
      } else datos.proveedores.push({ id: uid('p'), ...datosP });
    });
    if (ok) { limpiarProveedor(); toast('Proveedor guardado ✅'); }
  }
  async function borrarProveedor(id) {
    const usos = datos.ventas.filter(v => v.proveedorId === id).length;
    if (!confirm('¿Eliminar este proveedor?' + (usos ? `\nTiene ${usos} venta(s) asociada(s): se conserva su nombre en esas ventas.` : ''))) return;
    const ok = await mutar(() => { datos.proveedores = datos.proveedores.filter(p => p.id !== id); });
    if (ok) toast('Proveedor eliminado');
  }

  // ============================================================
  // RECIBO DE COMPRA (imprimir / PDF / imagen para WhatsApp)
  // ============================================================
  const RCF = typeof RECIBO_CONFIG !== 'undefined' ? RECIBO_CONFIG : {};
  const RC_ESTADOS = [
    ['enciende', 'Enciende y funciona correctamente'], ['pantalla', 'Pantalla sin rayones ni golpes'],
    ['tactil', 'Táctil y botones funcionando'], ['faceid', 'Face ID / Touch ID funcionando'],
    ['camaras', 'Cámaras frontal y trasera OK'], ['audio', 'Altavoz, micrófono y vibración OK'],
    ['carga', 'Carga y puerto de conexión OK'], ['senal', 'Señal, Wi-Fi y Bluetooth OK'],
    ['icloud', 'Sin cuenta iCloud ni bloqueos'], ['imei', 'IMEI verificado y coincide'],
    ['estetica', 'Estética acorde a lo informado'], ['caja', 'Entregado con caja original']
  ];
  const RC_OBSEQUIOS = [['cargador', 'Cargador / fuente'], ['cable', 'Cable'], ['airpods', 'AirPods'], ['funda', 'Funda'], ['vidrio', 'Vidrio templado']];
  let rc = null;

  const garantiaDefault = (v, p) => (p && p.garantia) || (v.condicion === 'Nuevo' ? '1 año de garantía Apple' : 'Garantía 6 meses incluida');
  function asegurarNro(v) {
    if (v.nro) return;
    v.nro = datos.ventas.reduce((m, x) => Math.max(m, x.nro || 0), 0) + 1;
  }
  const nroTxt = v => String(v.nro || 0).padStart(4, '0');
  function datosNegocio() {
    const cfg = typeof CONFIG !== 'undefined' ? CONFIG : {};
    const d = String(cfg.whatsapp || '').replace(/\D/g, '');
    const wa = d.length === 13 ? `+${d.slice(0, 2)} ${d.slice(2, 3)} ${d.slice(3, 6)} ${d.slice(6, 9)}-${d.slice(9)}` : (d ? '+' + d : '');
    const ig = (String(cfg.instagram || '').match(/instagram\.com\/([^/?#]+)/) || [])[1];
    return { web: RCF.web || location.host, wa, ig: ig ? '@' + ig : '' };
  }
  const politicas = (v, garantia) => {
    const dias = RCF.diasCambioObsequios || 14;
    const l = [
      'El cliente revisó y probó el equipo en el momento de la entrega. Con su firma declara recibirlo en el estado tildado en este recibo.',
      `Garantía del equipo: ${garantia || 'según lo informado por el vendedor'}. Cubre fallas de funcionamiento no ocasionadas por el usuario. No cubre golpes, pantalla o vidrio roto, humedad o líquidos, aperturas o reparaciones de terceros, mal uso ni modificaciones de software.`,
      'Cambios y devoluciones del equipo: solo por falla de funcionamiento verificada dentro del plazo de garantía, con el equipo en el mismo estado, sin bloqueos ni daños, con su caja, accesorios originales y este recibo.',
      `Obsequios: los cargadores, cables, AirPods y demás accesorios entregados de regalo no tienen garantía y no admiten cambio pasados los ${dias} días corridos desde la entrega.`,
      'El equipo se entrega libre de bloqueos. El cliente es responsable de configurar su propio ID de Apple y de resguardar su información.',
      'Compras a distancia: rige el derecho de revocación de 10 días corridos de la Ley 24.240, devolviendo el equipo sin uso y en su estado original.'
    ];
    if (v.financiado) l.push('Venta a pagar: el cliente se compromete a abonar el saldo en las fechas acordadas.');
    return (RCF.politicas && RCF.politicas.length ? RCF.politicas : l);
  };

  function abrirRecibo(id) {
    const v = datos.ventas.find(x => x.id === id); if (!v) return;
    asegurarNro(v);
    const p = listaProductos().find(x => String(x.id) === String(v.productoId));
    const r = v.recibo || {};
    rc = {
      id, checks: new Set(r.checks || []), obsequios: new Set(r.obsequios || []), obs: r.obs || '',
      garantia: r.garantia != null ? r.garantia : garantiaDefault(v, p), bateria: v.bateria || (p && p.bateria) || '', firma: ''
    };
    const B = 'text-xs font-bold px-3 py-2 rounded-lg transition';
    modal(`
      <div class="vp-noprint">
        <div class="flex justify-between items-start gap-3 mb-3">
          <div><h3 class="font-heading font-black text-lg"><i class="fa-solid fa-receipt mr-2 text-blue-400"></i>Recibo N° ${nroTxt(v)}</h3>
          <p class="text-xs text-slate-400">Tildá el estado de entrega, hacé firmar al cliente en la pantalla y enviá o imprimí.</p></div>
          <button type="button" onclick="VP.cerrarModal()" class="text-slate-400 text-xl leading-none">×</button>
        </div>
        <div class="flex flex-wrap gap-2 mb-3">
          <button type="button" onclick="VP.rcImprimir()" class="${B} bg-blue-600 hover:bg-blue-500"><i class="fa-solid fa-print mr-1"></i>Imprimir / PDF</button>
          <button type="button" onclick="VP.rcDescargar()" class="${B} bg-emerald-600 hover:bg-emerald-500"><i class="fa-solid fa-image mr-1"></i>Descargar imagen</button>
          <button type="button" onclick="VP.rcCompartir()" class="${B} bg-emerald-700 hover:bg-emerald-600"><i class="fa-brands fa-whatsapp mr-1"></i>Compartir</button>
          ${v.telefono ? `<a href="${waLinkSimple(v)}" target="_blank" rel="noopener" class="${B} bg-white/10 hover:bg-white/15">Abrir chat del cliente</a>` : ''}
        </div>
        <div class="grid sm:grid-cols-2 gap-3 mb-3">
          <div><label class="text-xs text-slate-400 mb-1 block">Garantía del equipo (texto del recibo)</label><input value="${esc(rc.garantia)}" oninput="VP.rcCampo('garantia',this.value)" class="${INP}"></div>
          <div><label class="text-xs text-slate-400 mb-1 block">Observaciones</label><input value="${esc(rc.obs)}" oninput="VP.rcCampo('obs',this.value)" placeholder="Ej. leve marca en el marco" class="${INP}"></div>
        </div>
        <div class="flex flex-wrap gap-2 mb-3">
          <button type="button" onclick="VP.rcTildarTodo(true)" class="${B} bg-white/10 hover:bg-white/15">Tildar todo el estado</button>
          <button type="button" onclick="VP.rcTildarTodo(false)" class="${B} bg-white/10 hover:bg-white/15">Destildar</button>
          <button type="button" onclick="VP.rcBorrarFirma()" class="${B} bg-white/10 hover:bg-white/15">Borrar firma</button>
        </div>
      </div>
      <div class="rc-wrap" id="rc-wrap"><div id="rc-doc" class="rc-doc"></div></div>`, 'max-w-4xl');
    rcRender(); rcZoom();
  }
  function waLinkSimple(v) {
    let d = String(v.telefono || '').replace(/\D/g, '').replace(/^0+/, '');
    if (!d.startsWith('54')) d = '549' + d;
    return `https://wa.me/${d}?text=${encodeURIComponent(`Hola ${v.cliente || ''}! Te paso el recibo de tu compra en Matos iPhone Rosario. ¡Gracias!`)}`;
  }
  function rcZoom() {
    const w = $('rc-wrap'); if (!w) return;
    const disp = Math.min(window.innerWidth - 56, 794);
    w.style.zoom = disp < 794 ? (disp / 794).toFixed(3) : 1;
  }
  function rcCampo(k, val) { rc[k] = val; rcRender(); }
  function rcToggle(grupo, k, el) {
    const set = grupo === 'c' ? rc.checks : rc.obsequios;
    set.has(k) ? set.delete(k) : set.add(k);
    const on = set.has(k);
    el.firstElementChild.classList.toggle('on', on); el.firstElementChild.textContent = on ? '✓' : '';
  }
  function rcTildarTodo(on) { rc.checks = on ? new Set(RC_ESTADOS.map(e => e[0])) : new Set(); rcRender(); }
  function rcBorrarFirma() { rc.firma = ''; rcRender(); }

  function rcRender() {
    const v = datos.ventas.find(x => x.id === rc.id), doc = $('rc-doc'); if (!v || !doc) return;
    const n = datosNegocio(), esARS = (METODOS[v.metodo] || {}).moneda === 'ARS', k = esARS ? v.cot : 1, fm = esARS ? fARS : fUSD;
    const base = v.precioUSD * v.cantidad * k, recargo = v.brutoUSD * k - base, total = v.brutoUSD * k;
    const chk = (g, key, label) => {
      const on = (g === 'c' ? rc.checks : rc.obsequios).has(key);
      return `<div class="rc-chk" onclick="VP.rcToggle('${g}','${key}',this)"><span class="rc-box ${on ? 'on' : ''}">${on ? '✓' : ''}</span><span>${label}</span></div>`;
    };
    const m = METODOS[v.metodo] || { label: v.metodo };
    let pago = `<b>${m.label}</b>`;
    if (v.metodo === 'credito') pago += ` — ${v.cuotas} ${v.cuotas === 1 ? 'pago' : 'cuotas'} de <b>${fARS(v.valorCuotaARS)}</b> (total ${fARS(v.brutoARS)})`;
    if (v.metodo === 'debito') pago += ' — importe final con recargo de débito';
    if (v.metodo === 'cripto' && v.cripto) pago += ` — ${esc(v.cripto.moneda)}${v.cripto.nota ? ' (' + esc(v.cripto.nota) + ')' : ''}`;
    if (v.metodo === 'usd') pago += ' — dólares billete';
    let fin = '';
    if (v.financiado) {
      const e = estadoPlan(v);
      fin = `<div class="rc-fin">Entregado a pagar · Pagado a la fecha: <b>${fUSD(e.pagado)}</b> · Saldo pendiente: <b>${fUSD(e.debe)}</b>${v.financiado.cuotasPactadas ? ` · ${v.financiado.cuotasPactadas} cuotas de ~${fUSD(e.valorCuotaUSD)}${v.financiado.primerVencimiento ? ', 1er vencimiento ' + fmtF(v.financiado.primerVencimiento) : ''}` : ''}</div>`;
    }
    const ref = esARS ? `Equivale a ${fUSD(v.brutoUSD)} · cotización de referencia ${fARS(v.cot)}` : `Equivale a ${fARS(v.brutoARS)} · cotización de referencia ${fARS(v.cot)}`;
    const imeiTxt = v.imei ? (String(v.imei).length <= 8 ? '…' + esc(v.imei) : esc(v.imei)) : '';
    doc.innerHTML = `
      <div class="rc-head">
        <img src="Logo.png" alt="Matos iPhone Rosario" crossorigin="anonymous" onerror="this.style.display='none'">
        <div class="rc-title"><div class="rc-t1">RECIBO DE COMPRA</div><div>N° <b>${nroTxt(v)}</b></div><div>Fecha: <b>${fmtF(v.fecha)}</b></div></div>
      </div>
      <div class="rc-contact"><span>🌐 ${esc(n.web)}</span><span>💬 WhatsApp ${esc(n.wa)}</span>${n.ig ? `<span>📷 ${esc(n.ig)}</span>` : ''}</div>

      <div class="rc-cols">
        <div class="rc-box2"><div class="rc-h">Cliente</div><div><b>${esc(v.cliente || '—')}</b></div><div>Tel: ${esc(v.telefono || '—')}</div></div>
        <div class="rc-box2"><div class="rc-h">Equipo</div><div><b>${esc(v.nombre)}</b> ${esc(v.specs || '')}</div>
          <div>${v.condicion ? esc(v.condicion === 'Como Nuevo' ? 'Usado' : v.condicion) + ' · ' : ''}${rc.bateria && rc.bateria !== 'N/A' ? 'Batería ' + esc(rc.bateria) + ' · ' : ''}${imeiTxt ? 'IMEI ' + imeiTxt : ''}</div></div>
      </div>

      <table class="rc-tab"><thead><tr><th>Descripción</th><th class="r">Cant.</th><th class="r">Precio unit.</th><th class="r">Importe</th></tr></thead><tbody>
        <tr><td>${esc(v.nombre)} ${esc(v.specs || '')}</td><td class="r">${v.cantidad}</td><td class="r">${fm(v.precioUSD * k)}</td><td class="r">${fm(base)}</td></tr>
        ${Math.abs(recargo) > 0.005 ? `<tr><td>${recargo > 0 ? 'Recargo' : 'Descuento'} por medio de pago / financiación (${Math.abs(v.recargoPct)}%)</td><td></td><td></td><td class="r">${recargo > 0 ? '' : '−'}${fm(Math.abs(recargo))}</td></tr>` : ''}
        <tr class="tot"><td colspan="3" class="r">TOTAL</td><td class="r">${fm(total)}</td></tr>
      </tbody></table>
      <div class="rc-pago">Forma de pago: ${pago}<span class="rc-ref">${ref}</span></div>${fin}

      <div class="rc-h2">Estado de entrega del equipo${rc.bateria && rc.bateria !== 'N/A' ? ` <span>· Batería informada: ${esc(rc.bateria)}</span>` : ''}</div>
      <div class="rc-grid">${RC_ESTADOS.map(([key, l]) => chk('c', key, l)).join('')}</div>
      <div class="rc-h2">Obsequios entregados <span>· sin garantía</span></div>
      <div class="rc-grid5">${RC_OBSEQUIOS.map(([key, l]) => chk('o', key, l)).join('')}</div>
      ${rc.obs ? `<div class="rc-obs"><b>Observaciones:</b> ${esc(rc.obs)}</div>` : ''}

      <div class="rc-h2">Condiciones de venta</div>
      <ol class="rc-pol">${politicas(v, rc.garantia).map(t => `<li>${esc(t)}</li>`).join('')}</ol>

      <div class="rc-conf">Declaro haber recibido el equipo en el estado indicado, haber probado su funcionamiento y aceptar las condiciones de venta.</div>
      <div class="rc-firmas">
        <div><canvas id="rc-firma" width="520" height="150"></canvas><div class="rc-line">Firma del cliente</div><div class="rc-sub">Aclaración: ${esc(v.cliente || '')} &nbsp;&nbsp; DNI: ____________________</div></div>
        <div><div class="rc-vend"></div><div class="rc-line">Matos iPhone Rosario</div><div class="rc-sub">Firma y sello del vendedor</div></div>
      </div>
      <div class="rc-foot">¡Gracias por tu compra! · Documento no válido como factura</div>`;
    rcFirma();
  }

  function rcFirma() {
    const c = $('rc-firma'); if (!c) return;
    const ctx = c.getContext('2d'); ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0a1f44';
    if (rc.firma) { const im = new Image(); im.onload = () => ctx.drawImage(im, 0, 0, c.width, c.height); im.src = rc.firma; }
    let dib = false, last = null;
    const pos = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
    c.onpointerdown = e => { dib = true; last = pos(e); c.setPointerCapture(e.pointerId); e.preventDefault(); };
    c.onpointermove = e => { if (!dib) return; const p = pos(e); ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(p[0], p[1]); ctx.stroke(); last = p; };
    const fin = () => { if (dib) { dib = false; rc.firma = c.toDataURL('image/png'); } };
    c.onpointerup = fin; c.onpointercancel = fin;
  }

  async function guardarRecibo() {
    const v = datos.ventas.find(x => x.id === rc.id); if (!v) return false;
    const snap = { checks: [...rc.checks], obsequios: [...rc.obsequios], obs: rc.obs, garantia: rc.garantia, fecha: hoyISO() };
    // La firma NO se guarda en la nube (el bin gratuito tiene límite de tamaño): solo sale en lo que imprimís o enviás.
    return mutar(() => { const x = datos.ventas.find(y => y.id === rc.id); x.nro = x.nro || v.nro; x.recibo = snap; });
  }
  const nombreArchivo = v => `Recibo-${nroTxt(v)}-${String(v.cliente || 'cliente').replace(/[^\w]+/g, '_')}`;

  async function rcImprimir() {
    const v = datos.ventas.find(x => x.id === rc.id); if (!v) return;
    await guardarRecibo();
    const w = $('rc-wrap'), z = w.style.zoom, t = document.title;
    w.style.zoom = 1; document.title = nombreArchivo(v); document.body.classList.add('vp-printing');
    window.addEventListener('afterprint', () => { document.body.classList.remove('vp-printing'); document.title = t; rcZoom(); }, { once: true });
    setTimeout(() => window.print(), 80);
  }

  function cargarScript(src) {
    return new Promise((ok, mal) => {
      if (window.html2canvas) return ok();
      const s = document.createElement('script'); s.src = src; s.onload = ok;
      s.onerror = () => mal(new Error('No se pudo cargar el generador de imágenes'));
      document.head.appendChild(s);
    });
  }
  async function rcBlob() {
    await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    const w = $('rc-wrap'), z = w.style.zoom; w.style.zoom = 1;
    try {
      const canvas = await window.html2canvas($('rc-doc'), { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      return await new Promise(res => canvas.toBlob(res, 'image/png'));
    } finally { w.style.zoom = z; }
  }
  async function rcDescargar() {
    const v = datos.ventas.find(x => x.id === rc.id); if (!v) return;
    try {
      toast('Generando imagen...'); await guardarRecibo();
      const blob = await rcBlob(), url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = nombreArchivo(v) + '.png'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('Imagen descargada ✅');
    } catch (e) { toast('⚠️ ' + e.message + '. Usá "Imprimir / PDF" y elegí guardar como PDF.'); }
  }
  async function rcCompartir() {
    const v = datos.ventas.find(x => x.id === rc.id); if (!v) return;
    try {
      toast('Generando imagen...'); await guardarRecibo();
      const blob = await rcBlob(), file = new File([blob], nombreArchivo(v) + '.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Recibo de compra ' + nroTxt(v), text: 'Recibo de compra - Matos iPhone Rosario' });
      } else {
        const url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
        toast('Este navegador no permite compartir directo: se descargó la imagen, adjuntala en WhatsApp.');
      }
    } catch (e) { if (e.name !== 'AbortError') toast('⚠️ ' + e.message); }
  }

  const RC_CSS = `
  .rc-wrap { overflow-x: auto; }
  .rc-doc { width: 794px; box-sizing: border-box; background: #fff; color: #0f172a; font-family: Inter, Arial, sans-serif; font-size: 11px; line-height: 1.35; padding: 0 0 18px; margin: 0 auto; }
  .rc-doc * { box-sizing: border-box; }
  .rc-head { background: #031435; color: #fff; display: flex; align-items: center; justify-content: space-between; padding: 14px 26px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .rc-head img { height: 46px; width: auto; max-width: 260px; object-fit: contain; }
  .rc-title { text-align: right; font-size: 11px; } .rc-t1 { font-family: Outfit, Inter, sans-serif; font-size: 18px; font-weight: 800; letter-spacing: .5px; }
  .rc-contact { display: flex; justify-content: space-between; gap: 8px; background: #e8eefc; padding: 6px 26px; font-weight: 600; font-size: 10.5px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .rc-doc > *:not(.rc-head):not(.rc-contact) { margin-left: 26px; margin-right: 26px; }
  .rc-cols { display: grid; grid-template-columns: 1fr 1.4fr; gap: 10px; margin-top: 12px; }
  .rc-box2 { border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px 10px; }
  .rc-h { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .6px; color: #1d4ed8; margin-bottom: 2px; }
  .rc-tab { width: calc(100% - 52px); border-collapse: collapse; margin-top: 10px; font-size: 11px; }
  .rc-tab th { background: #f1f5f9; text-align: left; padding: 5px 8px; font-size: 9.5px; border-bottom: 1px solid #cbd5e1; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .rc-tab td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; } .rc-tab .r { text-align: right; white-space: nowrap; }
  .rc-tab tr.tot td { font-weight: 800; font-size: 13px; border-bottom: 2px solid #031435; }
  .rc-pago { margin-top: 7px; padding: 6px 10px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0; }
  .rc-ref { display: block; color: #64748b; font-size: 9.5px; }
  .rc-fin { margin-top: 5px; padding: 6px 10px; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 6px; }
  .rc-h2 { margin-top: 11px; margin-bottom: 4px; font-weight: 800; font-size: 11px; border-bottom: 1.5px solid #031435; padding-bottom: 2px; } .rc-h2 span { font-weight: 500; color: #64748b; font-size: 10px; }
  .rc-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 10px; } .rc-grid5 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px 8px; }
  .rc-chk { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 10.5px; }
  .rc-box { flex: none; width: 14px; height: 14px; border: 1.5px solid #031435; border-radius: 3px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 900; color: #047857; line-height: 1; }
  .rc-box.on { background: #d1fae5; }
  .rc-obs { margin-top: 6px; font-size: 10.5px; }
  .rc-pol { margin-top: 0; padding-left: 16px !important; margin-bottom: 0; font-size: 8.8px; line-height: 1.32; color: #334155; } .rc-pol li { margin-bottom: 2px; }
  .rc-conf { margin-top: 10px; font-weight: 700; font-size: 10.5px; }
  .rc-firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 4px; }
  .rc-firmas canvas { width: 100%; height: 66px; display: block; touch-action: none; cursor: crosshair; background: repeating-linear-gradient(#fff, #fff); }
  .rc-vend { height: 66px; } .rc-line { border-top: 1.5px solid #0f172a; text-align: center; font-weight: 700; padding-top: 2px; font-size: 10.5px; } .rc-sub { text-align: center; color: #64748b; font-size: 9.5px; }
  .rc-foot { margin-top: 10px; text-align: center; color: #64748b; font-size: 9.5px; }
  @media print {
    @page { size: A4; margin: 8mm; }
    body.vp-printing > *:not(#vp-modal) { display: none !important; }
    body.vp-printing { background: #fff !important; }
    body.vp-printing #vp-modal { position: static !important; display: block !important; background: #fff !important; padding: 0 !important; }
    body.vp-printing #vp-modal > div { max-width: none !important; max-height: none !important; overflow: visible !important; border: 0 !important; box-shadow: none !important; padding: 0 !important; background: #fff !important; }
    body.vp-printing .vp-noprint { display: none !important; }
    body.vp-printing .rc-wrap { zoom: 1 !important; overflow: visible !important; }
    body.vp-printing .rc-doc { width: 100% !important; }
  }`;

  // ============================================================
  // INIT
  // ============================================================
  function renderTodo() {
    if (!inited) return;
    refrescarSelectProveedores();
    renderVentas(); renderFinanciados(); renderProveedores();
    setBanner(nubeOk ? '' : lastError);
  }

  async function init() {
    if (inited) return;
    $('tab-ventas').innerHTML = esqueletoVentas();
    $('tab-financiados').innerHTML = esqueletoFinanciados();
    $('tab-proveedores').innerHTML = esqueletoProveedores();
    const st = document.createElement('style'); st.id = 'vp-style'; st.textContent = RC_CSS; document.head.appendChild(st);
    window.addEventListener('resize', rcZoom);
    const mod = document.createElement('div');
    mod.id = 'vp-modal'; mod.className = 'hidden fixed inset-0 z-[90] bg-black/70 items-center justify-center p-3';
    mod.addEventListener('click', e => { if (e.target === mod) cerrarModal(); });
    document.body.appendChild(mod);
    inited = true;

    setOrigen('catalogo'); resetForm();
    await cargar();
    renderTodo();
    let t = 'catalogo'; try { t = sessionStorage.getItem('matos_tab') || 'catalogo'; } catch (e) { /* ignore */ }
    tab(t);
  }

  // Hacer que el selector de productos se refresque cuando el catálogo termine de cargar
  function refrescarCatalogo() { if (inited) renderOpcionesProductos(); }

  const API = {
    init, tab, setOrigen, setMetodo, onCuotas, onProducto, filtrarProductos, preview, registrar, proveedorRapido,
    renderVentas, renderFinanciados, verVenta, borrarVenta, exportarCSV, cerrarModal, nuevoFinanciado,
    abrirRecibo, rcCampo, rcToggle, rcTildarTodo, rcBorrarFirma, rcImprimir, rcDescargar, rcCompartir,
    togglePlan, abrirPago, previewPago, guardarPago, borrarPago,
    guardarProveedor, limpiarProveedor, editarProveedor, borrarProveedor, reintentar, refrescarCatalogo,
    // para pruebas
    _calc: { calcularVenta, estadoPlan, resumen, pagadoUSD, debeUSD, addMonths, diasEntre, recargoDefault, comisionDefault }
  };
  global.VP = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
