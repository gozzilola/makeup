// Presupuestos: armado, imagen para WhatsApp, PDF y paso a cita.
// Se guardan en el dispositivo (localStorage).

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtDay = (s) => cap(parseYmd(s).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
const fmtNum = (s) => parseYmd(s).toLocaleDateString('es-AR');
const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-AR')}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const TYPES = {
  novia: { label: 'Novia', icon: '👰' },
  quince: { label: '15 años', icon: '👑' },
  social: { label: 'Social', icon: '💄' },
  otro: { label: 'Otro', icon: '✨' },
};
const STATUS = { borrador: 'Borrador', enviado: 'Enviado', aceptado: 'Agendado' };

let deps; // { getSettings, openForm, toast, waNumber }

const read = () => { try { return JSON.parse(localStorage.getItem('am_budgets') || '[]'); } catch { return []; } };
const write = (list) => localStorage.setItem('am_budgets', JSON.stringify(list));
function upsert(b) {
  const list = read();
  const i = list.findIndex((x) => x.id === b.id);
  if (i >= 0) list[i] = b; else list.unshift(b);
  write(list);
}
function nextNumber() {
  const n = (Number(localStorage.getItem('am_budget_seq')) || 0) + 1;
  localStorage.setItem('am_budget_seq', String(n));
  return n;
}

function servicePrice(name) {
  return deps.getSettings().services.find((s) => s.name === name)?.price ?? '';
}

function presetItems(type) {
  const s = deps.getSettings();
  const guest = { desc: 'Maquillaje invitadas', qty: 0, price: s.guestPrice ?? '' };
  switch (type) {
    case 'novia': return [
      { desc: 'Maquillaje de novia', qty: 1, price: servicePrice('Maquillaje de novia') },
      { desc: 'Prueba de maquillaje', qty: 1, price: servicePrice('Prueba de maquillaje') },
      guest,
    ];
    case 'quince': return [
      { desc: 'Maquillaje 15 años', qty: 1, price: servicePrice('Maquillaje 15 años') },
      { ...guest, desc: 'Maquillaje invitadas / familia' },
    ];
    case 'social': return [{ desc: 'Maquillaje social', qty: 1, price: servicePrice('Maquillaje social') }];
    default: return [{ desc: '', qty: 1, price: '' }];
  }
}

export function totals(b) {
  const items = b.items.filter((it) => Number(it.qty) > 0 && it.desc);
  const subtotal = items.reduce((s, it) => s + Number(it.qty) * (Number(it.price) || 0), 0);
  const travel = Number(b.travelFee) || 0;
  const discount = Number(b.discount) || 0;
  const total = Math.max(0, subtotal + travel - discount);
  const deposit = Math.ceil((total * (Number(b.depositPct) || 0)) / 100 / 100) * 100;
  // Personas a maquillar: no cuenta pruebas ni otros cargos.
  const people = items.filter((it) => /maquillaje|peinado/i.test(it.desc) && !/prueba/i.test(it.desc)).reduce((s, it) => s + Number(it.qty), 0);
  return { items, subtotal, travel, discount, total, deposit, people };
}

function newBudget(type = 'novia') {
  const s = deps.getSettings();
  return {
    id: `b${Date.now().toString(36)}`,
    number: null,
    created: ymd(new Date()),
    type,
    client: '', whatsapp: '', eventDate: '', place: '',
    items: presetItems(type),
    travelFee: '', discount: '',
    depositPct: s.depositPct ?? 30,
    validity: s.budgetValidity ?? 15,
    notes: '',
    status: 'borrador',
  };
}

// ---------------------------------------------------------------- imagen

function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) { out.push(line); line = word; } else line = test;
    }
    out.push(line);
  }
  return out;
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const C = { rose: '#b0306a', soft: '#fbe6ef', text: '#2b1d24', muted: '#8a7680', line: '#efdde5' };

function drawBudget(ctx, b, W, dry) {
  const s = deps.getSettings();
  const t = totals(b);
  const P = 72;
  let y = 0;
  const font = (w, px) => { ctx.font = `${w} ${px}px ${FONT}`; };
  const text = (str, x, yy, { align = 'left', color = C.text } = {}) => {
    if (dry) return;
    ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(str, x, yy);
  };
  const rect = (x, yy, w, h, color, r = 0) => {
    if (dry) return;
    ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, yy, w, h, r); ctx.fill();
  };

  // Encabezado
  const brand = s.businessName || 'Maquillaje profesional';
  font(700, 58);
  const brandLines = wrap(ctx, brand, W - 2 * P);
  const headH = 110 + brandLines.length * 66 + (s.businessContact ? 44 : 0);
  rect(0, 0, W, headH, C.rose);
  y = 70;
  font(600, 26);
  text('P R E S U P U E S T O', P, y, { color: '#f6c6da' });
  font(700, 58);
  for (const l of brandLines) { y += 66; text(l, P, y, { color: '#fff' }); }
  if (s.businessContact) { font(400, 28); y += 46; text(s.businessContact, P, y, { color: '#fde7f0' }); }
  y = headH + 70;

  // Datos
  font(400, 26);
  text(`N° ${pad(b.number ?? 0).padStart(4, '0')}  ·  ${fmtNum(b.created)}`, W - P, y - 4, { align: 'right', color: C.muted });
  text('Para', P, y - 4, { color: C.muted });
  font(700, 44);
  y += 48;
  for (const l of wrap(ctx, b.client || '—', W - 2 * P)) { text(l, P, y); y += 52; }
  const ev = [`${TYPES[b.type]?.icon || ''} ${TYPES[b.type]?.label || ''}`, b.eventDate && fmtDay(b.eventDate), b.place].filter(Boolean).join('  ·  ');
  font(400, 30);
  for (const l of wrap(ctx, ev, W - 2 * P)) { text(l, P, y, { color: C.muted }); y += 40; }
  y += 30;

  // Tabla
  const xQty = 690, xUnit = 850, xSub = W - P, descW = 560;
  font(600, 24);
  text('DETALLE', P, y, { color: C.muted });
  text('CANT.', xQty, y, { align: 'right', color: C.muted });
  text('PRECIO', xUnit, y, { align: 'right', color: C.muted });
  text('SUBTOTAL', xSub, y, { align: 'right', color: C.muted });
  y += 20;
  rect(P, y, W - 2 * P, 2, C.line);
  y += 50;
  for (const it of t.items) {
    font(400, 32);
    const lines = wrap(ctx, it.desc, descW);
    lines.forEach((l, i) => text(l, P, y + i * 40));
    text(String(it.qty), xQty, y, { align: 'right' });
    const free = !(Number(it.price) > 0);
    if (!free) text(money(it.price), xUnit, y, { align: 'right', color: C.muted });
    font(600, 32);
    text(free ? 'Sin cargo' : money(Number(it.qty) * Number(it.price)), xSub, y, { align: 'right', color: free ? C.rose : C.text });
    y += lines.length * 40 + 22;
    rect(P, y - 30, W - 2 * P, 1, C.line);
    y += 20;
  }
  font(400, 32);
  if (t.travel) { text('Traslado', P, y); text(money(t.travel), xSub, y, { align: 'right' }); y += 52; }
  if (t.discount) { text('Descuento', P, y); text(`−${money(t.discount)}`, xSub, y, { align: 'right', color: C.rose }); y += 52; }

  // Total
  y += 10;
  rect(P, y, W - 2 * P, 120, C.soft, 24);
  font(700, 34);
  text('TOTAL', P + 36, y + 74, { color: C.rose });
  font(800, 60);
  text(money(t.total), W - P - 36, y + 80, { align: 'right', color: C.rose });
  y += 180;

  font(400, 30);
  if (t.deposit) {
    text(`Seña para reservar la fecha: ${money(t.deposit)} (${b.depositPct}%)`, P, y);
    y += 46;
  }
  if (Number(b.validity) > 0) {
    text(`Presupuesto válido hasta el ${fmtNum(ymd(addDays(parseYmd(b.created), Number(b.validity))))}`, P, y, { color: C.muted });
    y += 46;
  }

  const extra = [b.notes, s.budgetTerms].filter(Boolean).join('\n');
  if (extra) {
    y += 24;
    font(600, 26);
    text('NOTAS Y CONDICIONES', P, y, { color: C.muted });
    y += 44;
    font(400, 28);
    for (const l of wrap(ctx, extra, W - 2 * P)) { text(l, P, y, { color: C.text }); y += 40; }
  }

  y += 60;
  rect(P, y - 30, W - 2 * P, 2, C.line);
  font(600, 32);
  y += 40;
  text('¡Gracias por elegirme! 💄', W / 2, y, { align: 'center', color: C.rose });
  return y + 70;
}

function budgetCanvas(b) {
  const W = 1080;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const H = drawBudget(ctx, b, W, true);
  c.width = W;
  c.height = H;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  drawBudget(ctx, b, W, false);
  return c;
}

function budgetText(b) {
  const s = deps.getSettings();
  const t = totals(b);
  const lines = [
    `*Presupuesto${s.businessName ? ` – ${s.businessName}` : ''}*`,
    `Para: ${b.client}`,
    `Evento: ${TYPES[b.type]?.label}${b.eventDate ? ` – ${fmtDay(b.eventDate)}` : ''}${b.place ? ` – ${b.place}` : ''}`,
    '',
    ...t.items.map((it) => (!(Number(it.price) > 0) ? `• ${Number(it.qty) > 1 ? `${it.qty} × ` : ''}${it.desc}: sin cargo` : Number(it.qty) > 1
      ? `• ${it.qty} × ${it.desc} (${money(it.price)} c/u): ${money(it.qty * it.price)}`
      : `• ${it.desc}: ${money(it.price)}`)),
    t.travel ? `• Traslado: ${money(t.travel)}` : null,
    t.discount ? `• Descuento: −${money(t.discount)}` : null,
    '',
    `*Total: ${money(t.total)}*`,
    t.deposit ? `Seña para reservar la fecha: ${money(t.deposit)}` : null,
    Number(b.validity) > 0 ? `Válido hasta el ${fmtNum(ymd(addDays(parseYmd(b.created), Number(b.validity))))}` : null,
    b.notes ? `\n${b.notes}` : null,
    s.budgetTerms ? `\n${s.budgetTerms}` : null,
  ];
  return lines.filter((l) => l !== null).join('\n');
}

const fileName = (b) => `presupuesto-${(b.client || 'clienta').toLowerCase().normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '')}.png`;

// ---------------------------------------------------------------- vista lista

export function renderBudgets(el) {
  const list = read();
  el.innerHTML = `
    <div class="list-head">
      <h2 class="section-title">Presupuestos <small>${list.length}</small></h2>
      <button class="btn primary small" data-b="new">＋ Nuevo</button>
    </div>
    ${list.length ? list.map((b) => {
      const t = totals(b);
      return `
      <article class="card budget">
        <div class="budget-top">
          <div>
            <h3>${TYPES[b.type]?.icon || ''} ${esc(b.client || 'Sin nombre')}</h3>
            <p class="muted">${TYPES[b.type]?.label}${b.eventDate ? ` · ${fmtDay(b.eventDate)}` : ''}${t.people > 1 ? ` · ${t.people} personas` : ''}</p>
          </div>
          <div class="budget-total"><b>${money(t.total)}</b><span class="chip st-${b.status}">${STATUS[b.status] || ''}</span></div>
        </div>
        <div class="actions">
          <button class="btn small primary" data-b="view" data-id="${b.id}">📤 Enviar</button>
          <button class="btn small" data-b="edit" data-id="${b.id}">Editar</button>
          <button class="btn small" data-b="book" data-id="${b.id}">📅 Agendar</button>
          <button class="btn small danger" data-b="del" data-id="${b.id}" aria-label="Eliminar">🗑</button>
        </div>
      </article>`;
    }).join('') : `
      <div class="card center">
        <p class="big">💰</p>
        <p>Armá presupuestos para novias, 15 años o maquillaje social y mandalos por WhatsApp como imagen.</p>
        <button class="btn primary" data-b="new">Crear el primero</button>
      </div>`}
    <p class="hint">Los presupuestos se guardan en este dispositivo.</p>`;
}

// ---------------------------------------------------------------- editor

let editing = null;
let itemsTouched = false;

function editorRow(it = { desc: '', qty: 1, price: '' }) {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `
    <input data-f="desc" list="svcNames" placeholder="Detalle" value="${esc(it.desc)}">
    <input data-f="qty" type="number" min="0" inputmode="numeric" value="${esc(it.qty)}" aria-label="Cantidad">
    <input data-f="price" type="number" min="0" inputmode="numeric" placeholder="$" value="${esc(it.price)}" aria-label="Precio unitario">
    <button type="button" class="icon-btn" aria-label="Quitar">✕</button>`;
  $('button', row).onclick = () => { row.remove(); itemsTouched = true; updateTotal(); };
  const desc = $('[data-f=desc]', row), price = $('[data-f=price]', row);
  desc.addEventListener('change', () => {
    const p = servicePrice(desc.value);
    if (p !== '' && !price.value) { price.value = p; updateTotal(); }
  });
  row.addEventListener('input', () => { itemsTouched = true; updateTotal(); });
  $('#bItems').append(row);
}

function readEditor() {
  const f = $('#budgetForm');
  return {
    ...editing,
    type: f.type.value,
    client: f.client.value.trim(),
    whatsapp: f.whatsapp.value.trim(),
    eventDate: f.eventDate.value,
    place: f.place.value.trim(),
    items: $$('.item-row', f).map((r) => ({
      desc: $('[data-f=desc]', r).value.trim(),
      qty: Number($('[data-f=qty]', r).value) || 0,
      price: $('[data-f=price]', r).value,
    })),
    travelFee: f.travelFee.value,
    discount: f.discount.value,
    depositPct: f.depositPct.value,
    validity: f.validity.value,
    notes: f.notes.value.trim(),
  };
}

function updateTotal() {
  const t = totals(readEditor());
  $('#bTotal').innerHTML = `Total <b>${money(t.total)}</b>${t.deposit ? ` <small>· seña ${money(t.deposit)}</small>` : ''}`;
}

function openEditor(b) {
  editing = b;
  itemsTouched = false;
  const f = $('#budgetForm');
  $('#bTitle').textContent = b.number ? `Presupuesto N° ${b.number}` : 'Nuevo presupuesto';
  $('#svcNames').innerHTML = deps.getSettings().services.map((s) => `<option value="${esc(s.name)}">`).join('');
  for (const k of ['client', 'whatsapp', 'eventDate', 'place', 'travelFee', 'discount', 'depositPct', 'validity', 'notes']) f[k].value = b[k] ?? '';
  f.type.value = b.type;
  $('#bItems').innerHTML = '';
  b.items.forEach(editorRow);
  updateTotal();
  $('#bdlg').showModal();
}

function changeType(type) {
  if (itemsTouched && !confirm('¿Reemplazar los ítems por los del nuevo tipo de evento?')) return;
  $('#bItems').innerHTML = '';
  presetItems(type).forEach(editorRow);
  itemsTouched = false;
  updateTotal();
}

// ---------------------------------------------------------------- vista previa / envío

let preview = null; // { b, blob, url, file }

async function openPreview(b) {
  const canvas = budgetCanvas(b);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  if (preview?.url) URL.revokeObjectURL(preview.url);
  const url = URL.createObjectURL(blob);
  preview = { b, blob, url, file: new File([blob], fileName(b), { type: 'image/png' }) };
  $('#pImg').src = url;
  $('#printImg').src = url;
  $('#pShare').textContent = canShareFiles() ? '📤 Enviar imagen por WhatsApp' : '📤 Descargar imagen y abrir WhatsApp';
  $('#pdlg').showModal();
}

const canShareFiles = () => {
  try { return !!navigator.canShare && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] }); } catch { return false; }
};

function markSent() {
  if (preview.b.status === 'borrador') { preview.b.status = 'enviado'; upsert(preview.b); refresh(); }
}

function download() {
  const a = document.createElement('a');
  a.href = preview.url;
  a.download = preview.file.name;
  document.body.append(a);
  a.click();
  a.remove();
}

function chatLink(text) {
  const num = deps.waNumber(preview.b.whatsapp);
  const q = text ? `?text=${encodeURIComponent(text)}` : '';
  return num ? `https://wa.me/${num}${q}` : `https://wa.me/${q}`;
}

async function shareImage() {
  if (canShareFiles()) {
    try {
      await navigator.share({ files: [preview.file], title: 'Presupuesto' });
      markSent();
    } catch (e) {
      if (e.name !== 'AbortError') deps.toast('No se pudo compartir. Probá con "Descargar imagen".', 4000);
    }
    return;
  }
  download();
  window.open(chatLink(`¡Hola ${(preview.b.client || '').split(' ')[0]}! Te paso el presupuesto 💄`), '_blank');
  deps.toast('Imagen descargada: adjuntala en el chat de WhatsApp 📎', 5000);
  markSent();
}

function shareText() {
  window.open(chatLink(budgetText(preview.b)), '_blank');
  markSent();
}

function printPdf() {
  $('#pdlg').close();
  document.body.classList.add('printing');
  setTimeout(() => {
    window.print();
    document.body.classList.remove('printing');
  }, 100);
}

// ---------------------------------------------------------------- inicialización

let refresh = () => {};

export function initBudgets(d) {
  deps = d;
  refresh = d.refresh;
  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="bdlg">
      <form id="budgetForm" novalidate>
        <header>
          <h2 id="bTitle">Nuevo presupuesto</h2>
          <button type="button" class="icon-btn" data-bclose aria-label="Cerrar">✕</button>
        </header>
        <div class="form-body">
          <fieldset class="seg">
            <legend>Tipo de evento</legend>
            ${Object.entries(TYPES).map(([k, v]) => `<label><input type="radio" name="type" value="${k}"><span>${v.icon} ${v.label}</span></label>`).join('')}
          </fieldset>
          <label>Clienta<input name="client" autocomplete="off" placeholder="Nombre"></label>
          <label>WhatsApp<input name="whatsapp" type="tel" inputmode="tel" placeholder="11 2345 6789"></label>
          <div class="row">
            <label>Fecha del evento<input name="eventDate" type="date"></label>
            <label>Lugar<input name="place" autocomplete="off" placeholder="Salón, barrio…"></label>
          </div>
          <div class="items-head"><span>Detalle</span><span>Cant.</span><span>Precio c/u</span><span></span></div>
          <div id="bItems"></div>
          <datalist id="svcNames"></datalist>
          <button type="button" class="btn small" id="bAddItem">＋ Agregar ítem</button>
          <p class="hint">Poné la cantidad de invitadas en la fila de invitadas. Las filas en 0 no aparecen en el presupuesto.</p>
          <div class="row">
            <label>Traslado ($)<input name="travelFee" type="number" min="0" inputmode="numeric"></label>
            <label>Descuento ($)<input name="discount" type="number" min="0" inputmode="numeric"></label>
          </div>
          <div class="row">
            <label>Seña (%)<input name="depositPct" type="number" min="0" max="100" inputmode="numeric"></label>
            <label>Válido por (días)<input name="validity" type="number" min="0" inputmode="numeric"></label>
          </div>
          <label>Notas para la clienta<textarea name="notes" rows="2" placeholder="Ej: incluye pestañas postizas"></textarea></label>
        </div>
        <footer>
          <div id="bTotal" class="b-total"></div>
          <span class="spacer"></span>
          <button type="submit" class="btn primary">Guardar y ver</button>
        </footer>
      </form>
    </dialog>
    <dialog id="pdlg">
      <div class="pwrap">
        <header>
          <h2>Presupuesto</h2>
          <button type="button" class="icon-btn" data-pclose aria-label="Cerrar">✕</button>
        </header>
        <div class="pimg"><img id="pImg" alt="Vista previa del presupuesto"></div>
        <footer class="pactions">
          <button type="button" class="btn wa block" id="pShare">📤 Enviar imagen por WhatsApp</button>
          <div class="row">
            <button type="button" class="btn" id="pText">💬 Mandar como texto</button>
            <button type="button" class="btn" id="pPdf">📄 Guardar PDF</button>
          </div>
          <button type="button" class="link" id="pDownload">⬇️ Descargar imagen</button>
        </footer>
      </div>
    </dialog>
    <div id="printArea"><img id="printImg" alt=""></div>`);

  const f = $('#budgetForm');
  f.addEventListener('change', (e) => { if (e.target.name === 'type') changeType(e.target.value); });
  f.addEventListener('input', (e) => { if (!e.target.closest('.item-row')) updateTotal(); });
  $('#bAddItem').onclick = () => { editorRow(); itemsTouched = true; $$('.item-row [data-f=desc]').at(-1).focus(); };
  $('[data-bclose]').onclick = () => $('#bdlg').close();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = readEditor();
    if (!b.client) { deps.toast('Poné el nombre de la clienta'); return; }
    if (!totals(b).items.length) { deps.toast('Agregá al menos un ítem con cantidad'); return; }
    const noPrice = totals(b).items.filter((it) => it.price === '' || it.price == null);
    if (noPrice.length) { deps.toast(`Falta el precio de: ${noPrice.map((it) => it.desc).join(', ')} (poné 0 si va sin cargo)`, 5000); return; }
    if (!b.number) b.number = nextNumber();
    upsert(b);
    $('#bdlg').close();
    refresh();
    await openPreview(b);
  });

  $('[data-pclose]').onclick = () => $('#pdlg').close();
  $('#pShare').onclick = shareImage;
  $('#pText').onclick = shareText;
  $('#pPdf').onclick = printPdf;
  $('#pDownload').onclick = download;

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-b]');
    if (!t) return;
    const b = read().find((x) => x.id === t.dataset.id);
    switch (t.dataset.b) {
      case 'new': return newBudgetDialog();
      case 'view': return b && openPreview(b);
      case 'edit': return b && openEditor(b);
      case 'del':
        if (b && confirm(`¿Eliminar el presupuesto de ${b.client || 'esta clienta'}?`)) { write(read().filter((x) => x.id !== b.id)); refresh(); }
        return;
      case 'book': {
        if (!b) return;
        const t2 = totals(b);
        b.status = 'aceptado';
        upsert(b);
        refresh();
        deps.openForm({
          date: b.eventDate || ymd(new Date()),
          prefill: {
            client: b.client,
            whatsapp: b.whatsapp,
            service: t2.items[0]?.desc,
            people: t2.people || 1,
            address: b.place,
            price: t2.total,
            notes: `Presupuesto N° ${b.number}${t2.items.length > 1 ? `: ${t2.items.map((it) => `${it.qty} × ${it.desc}`).join(', ')}` : ''}`,
          },
        });
      }
    }
  });
}

export function newBudgetDialog() {
  openEditor(newBudget());
}
