import { CONFIG } from './config.js';
import { initBudgets, renderBudgets, newBudgetDialog } from './budget.js';

const APP_TAG = 'agenda-maquillaje';
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
].join(' ');
const API = 'https://www.googleapis.com/calendar/v3';
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

// ---------------------------------------------------------------- utilidades

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const at = (dateStr, timeStr) => {
  const d = parseYmd(dateStr);
  const [h, mi] = timeStr.split(':').map(Number);
  d.setHours(h, mi, 0, 0);
  return d;
};
const addMin = (d, m) => new Date(d.getTime() + m * 60000);
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const minutesBetween = (a, b) => Math.round((b - a) / 60000);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtDay = (d) => cap(d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }));
const fmtShort = (d) => cap(d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }));
const fmtMonth = (d) => cap(d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }));
const fmtDur = (min) => {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
};
const money = (n) => (n || n === 0) && n !== '' ? `$${Number(n).toLocaleString('es-AR')}` : '';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------------------------------------------------------------- ajustes

const DEFAULT_SERVICES = [
  { name: 'Maquillaje social', duration: 60, price: '' },
  { name: 'Maquillaje de novia', duration: 120, price: '' },
  { name: 'Maquillaje 15 años', duration: 90, price: '' },
  { name: 'Prueba de maquillaje', duration: 90, price: '' },
  { name: 'Peinado', duration: 60, price: '' },
  { name: 'Maquillaje + peinado', duration: 120, price: '' },
];

const DEFAULT_SETTINGS = {
  clientId: CONFIG.GOOGLE_CLIENT_ID || '',
  calendarId: 'primary',
  workStart: '07:00',
  workEnd: '22:00',
  slotStep: 30,
  bufferAfter: 30,
  defaultTravel: 30,
  travelEvents: true,
  waPrefix: '549',
  waMessage: '¡Hola {nombre}! 💄 Te confirmo tu turno de {servicio} el {fecha} a las {hora}. ¡Nos vemos!',
  services: DEFAULT_SERVICES,
  businessName: '',
  businessContact: '',
  guestPrice: '',
  depositPct: 30,
  budgetValidity: 15,
  budgetTerms: 'La fecha queda reservada al abonar la seña. La seña no es reembolsable.',
};

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('am_settings') || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
function saveSettings() {
  localStorage.setItem('am_settings', JSON.stringify(settings));
}
let settings = loadSettings();

// ---------------------------------------------------------------- WhatsApp / mapas

function waNumber(raw) {
  if (!raw) return '';
  const trimmed = raw.trim();
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  if (trimmed.startsWith('+') || trimmed.startsWith('00')) return digits.replace(/^00/, '');
  const prefix = (settings.waPrefix || '').replace(/\D/g, '');
  const country = prefix.slice(0, 2);
  if (prefix && digits.startsWith(country) && digits.length > 10) return digits;
  digits = digits.replace(/^0/, '');
  return prefix + digits;
}
function waLink(appt, withMessage = true) {
  const num = waNumber(appt.whatsapp);
  if (!num) return '';
  if (!withMessage) return `https://wa.me/${num}`;
  const msg = (settings.waMessage || '')
    .replaceAll('{nombre}', (appt.client || '').split(' ')[0])
    .replaceAll('{servicio}', (appt.service || '').toLowerCase())
    .replaceAll('{fecha}', fmtDay(parseYmd(appt.date)).toLowerCase())
    .replaceAll('{hora}', appt.time);
  return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
}
const mapsLink = (addr) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`;

// ---------------------------------------------------------------- Google: autenticación

class AuthError extends Error {}

const auth = {
  token: null,
  exp: 0,
  load() {
    try {
      const t = JSON.parse(localStorage.getItem('am_token') || 'null');
      if (t && t.clientId === settings.clientId) Object.assign(this, { token: t.token, exp: t.exp });
    } catch { /* ignorar */ }
  },
  valid() { return !!this.token && this.exp > Date.now() + 60000; },
  clear() {
    this.token = null;
    this.exp = 0;
    localStorage.removeItem('am_token');
  },
  async waitForGis() {
    for (let i = 0; i < 100; i++) {
      if (window.google?.accounts?.oauth2) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('No se pudo cargar el inicio de sesión de Google. Revisá tu conexión.');
  },
  async login() {
    await this.waitForGis();
    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: settings.clientId,
        scope: SCOPES,
        callback: (r) => {
          if (r.error) return reject(new Error(r.error_description || r.error));
          if (!google.accounts.oauth2.hasGrantedAllScopes(r, 'https://www.googleapis.com/auth/calendar.events')) {
            return reject(new Error('Tenés que permitir el acceso a tu calendario para que la app pueda guardar las citas.'));
          }
          this.token = r.access_token;
          this.exp = Date.now() + Number(r.expires_in) * 1000;
          localStorage.setItem('am_token', JSON.stringify({ token: this.token, exp: this.exp, clientId: settings.clientId }));
          localStorage.setItem('am_connected', '1');
          resolve();
        },
        error_callback: (e) => reject(new Error(e.type === 'popup_closed' ? 'Se cerró la ventana de Google.' : (e.message || 'No se pudo conectar con Google.'))),
      });
      client.requestAccessToken({ prompt: localStorage.getItem('am_connected') ? '' : 'consent' });
    });
  },
  logout() {
    if (this.token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(this.token, () => {});
    this.clear();
    localStorage.removeItem('am_connected');
  },
};

// ---------------------------------------------------------------- backends

class GoogleBackend {
  get kind() { return 'google'; }
  cal() { return `/calendars/${encodeURIComponent(settings.calendarId || 'primary')}`; }
  async request(path, { method = 'GET', body, query } = {}) {
    if (!auth.valid()) throw new AuthError('Conectate con Google para ver y guardar tus citas.');
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      auth.clear();
      throw new AuthError('Tu sesión de Google venció. Volvé a conectarte.');
    }
    if (method === 'DELETE' && (res.status === 404 || res.status === 410)) return null;
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error?.message || ''; } catch { /* ignorar */ }
      const err = new Error(`Google Calendar respondió ${res.status}${detail ? `: ${detail}` : ''}`);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }
  async list(timeMin, timeMax) {
    const items = [];
    let pageToken;
    do {
      const query = {
        timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(),
        singleEvents: 'true', orderBy: 'startTime', maxResults: '2500',
      };
      if (pageToken) query.pageToken = pageToken;
      const r = await this.request(`${this.cal()}/events`, { query });
      items.push(...(r.items || []));
      pageToken = r.nextPageToken;
    } while (pageToken);
    return items;
  }
  insert(ev) { return this.request(`${this.cal()}/events`, { method: 'POST', body: ev }); }
  patch(id, ev) { return this.request(`${this.cal()}/events/${encodeURIComponent(id)}`, { method: 'PATCH', body: ev }); }
  remove(id) { return this.request(`${this.cal()}/events/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  async calendars() {
    const r = await this.request('/users/me/calendarList', { query: { minAccessRole: 'writer' } });
    return (r.items || []).map((c) => ({ id: c.primary ? 'primary' : c.id, summary: c.summaryOverride || c.summary, primary: !!c.primary }));
  }
}

// Modo prueba: guarda eventos con el mismo formato que Google, pero en el dispositivo.
class LocalBackend {
  get kind() { return 'local'; }
  read() { try { return JSON.parse(localStorage.getItem('am_demo_events') || '[]'); } catch { return []; } }
  write(evs) { localStorage.setItem('am_demo_events', JSON.stringify(evs)); }
  async list(timeMin, timeMax) {
    return this.read()
      .filter((e) => new Date(e.start.dateTime) < timeMax && new Date(e.end.dateTime) > timeMin)
      .sort((a, b) => new Date(a.start.dateTime) - new Date(b.start.dateTime));
  }
  async insert(ev) {
    const e = structuredClone({ ...ev, id: `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}` });
    this.write([...this.read(), e]);
    return e;
  }
  async patch(id, ev) {
    const evs = this.read();
    const i = evs.findIndex((e) => e.id === id);
    if (i < 0) { const err = new Error('No encontrado'); err.status = 404; throw err; }
    const merge = (a, b) => {
      for (const [k, v] of Object.entries(b)) {
        a[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : structuredClone(v);
      }
      return a;
    };
    evs[i] = merge(evs[i], ev);
    this.write(evs);
    return evs[i];
  }
  async remove(id) { this.write(this.read().filter((e) => e.id !== id)); }
  async calendars() { return [{ id: 'primary', summary: 'Este dispositivo', primary: true }]; }
}

let backend = settings.clientId ? new GoogleBackend() : new LocalBackend();

// ---------------------------------------------------------------- citas <-> eventos

function apptToEvent(a) {
  const start = at(a.date, a.time);
  const end = addMin(start, a.duration);
  const leave = addMin(start, -a.travel);
  const wa = waLink(a, false);
  const description = [
    `👩 Clienta: ${a.client}`,
    a.whatsapp ? `📱 WhatsApp: ${a.whatsapp}${wa ? ` — ${wa}` : ''}` : null,
    `💄 Servicio: ${a.service}${a.people > 1 ? ` (${a.people} personas)` : ''}`,
    a.travel > 0 ? `🚗 Salir de casa: ${hm(leave)} (${a.travel} min de viaje)` : null,
    `⏰ Llegar a las: ${a.time}`,
    a.address ? `📍 Dirección: ${a.address}` : null,
    a.price !== '' ? `💲 Precio: ${money(a.price)}` : null,
    a.deposit !== '' ? `💵 Seña: ${money(a.deposit)}` : null,
    a.notes ? `📝 ${a.notes}` : null,
    '',
    '— Agenda Maquillaje',
  ].filter((l) => l !== null).join('\n');

  const reminders = [{ method: 'popup', minutes: 24 * 60 }];
  if (a.travel > 0) reminders.push({ method: 'popup', minutes: a.travel }, { method: 'popup', minutes: a.travel + 30 });
  else reminders.push({ method: 'popup', minutes: 60 });

  return {
    summary: `💄 ${a.client} · ${a.service}`,
    location: a.address || '',
    description,
    start: { dateTime: start.toISOString(), timeZone: TZ },
    end: { dateTime: end.toISOString(), timeZone: TZ },
    colorId: '4',
    reminders: { useDefault: false, overrides: reminders },
    extendedProperties: {
      private: {
        app: APP_TAG,
        role: 'cita',
        client: a.client,
        whatsapp: a.whatsapp || '',
        service: a.service,
        travel: String(a.travel || 0),
        people: String(a.people || 1),
        price: String(a.price ?? ''),
        deposit: String(a.deposit ?? ''),
        notes: a.notes || '',
      },
    },
  };
}

function travelToEvent(a, parentId) {
  const start = at(a.date, a.time);
  return {
    summary: `🚗 Salir hacia ${a.client}`,
    location: a.address || '',
    description: `Viaje a la cita de ${a.client} (${a.service}). Llegar a las ${a.time}.`,
    start: { dateTime: addMin(start, -a.travel).toISOString(), timeZone: TZ },
    end: { dateTime: start.toISOString(), timeZone: TZ },
    colorId: '8',
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: { private: { app: APP_TAG, role: 'traslado', parent: parentId } },
  };
}

function eventToItem(ev) {
  const p = ev.extendedProperties?.private || {};
  const allDay = !!ev.start?.date;
  const start = allDay ? parseYmd(ev.start.date) : new Date(ev.start.dateTime);
  const end = allDay ? parseYmd(ev.end.date) : new Date(ev.end.dateTime);
  const kind = p.app === APP_TAG ? (p.role === 'traslado' ? 'traslado' : 'cita') : 'otro';
  const item = {
    id: ev.id, kind, start, end, allDay,
    title: ev.summary || '(Sin título)',
    free: ev.transparency === 'transparent',
    parent: p.parent,
  };
  if (kind === 'cita') {
    const travel = Number(p.travel) || 0;
    item.appt = {
      id: ev.id,
      client: p.client || ev.summary || '',
      whatsapp: p.whatsapp || '',
      service: p.service || '',
      duration: minutesBetween(start, end),
      people: Number(p.people) || 1,
      travel,
      price: p.price ?? '',
      deposit: p.deposit ?? '',
      notes: p.notes || '',
      address: ev.location || '',
      date: ymd(start),
      time: hm(start),
      travelEventId: p.travelEventId || '',
    };
    item.leave = addMin(start, -travel);
  }
  return item;
}

// ---------------------------------------------------------------- datos

const cache = new Map();
function fetchRange(min, max) {
  const key = `${min.getTime()}|${max.getTime()}`;
  if (!cache.has(key)) {
    cache.set(key, backend.list(min, max).then((evs) => evs.map(eventToItem)).catch((e) => { cache.delete(key); throw e; }));
  }
  return cache.get(key);
}
const fetchDay = (dateStr) => { const d = parseYmd(dateStr); return fetchRange(d, addDays(d, 1)); };

async function saveAppt(a) {
  const body = apptToEvent(a);
  const ev = a.id ? await backend.patch(a.id, body) : await backend.insert(body);
  const oldTravelId = a.travelEventId || '';
  let travelId = oldTravelId;
  if (settings.travelEvents && a.travel > 0) {
    const tev = travelToEvent(a, ev.id);
    if (travelId) {
      try { await backend.patch(travelId, tev); } catch { travelId = ''; }
    }
    if (!travelId) travelId = (await backend.insert(tev)).id;
  } else if (travelId) {
    await backend.remove(travelId).catch(() => {});
    travelId = '';
  }
  if (travelId !== oldTravelId) {
    await backend.patch(ev.id, { extendedProperties: { private: { travelEventId: travelId } } });
  }
  cache.clear();
}

async function deleteAppt(a) {
  if (a.travelEventId) await backend.remove(a.travelEventId).catch(() => {});
  await backend.remove(a.id);
  cache.clear();
}

// ---------------------------------------------------------------- disponibilidad

function busyIntervals(items, excludeId) {
  const citaIds = new Set(items.filter((i) => i.kind === 'cita').map((i) => i.id));
  const out = [];
  for (const it of items) {
    if (it.allDay || it.free || it.id === excludeId) continue;
    if (it.kind === 'cita') out.push([it.leave, addMin(it.end, Number(settings.bufferAfter) || 0)]);
    else if (it.kind === 'traslado') { if (!citaIds.has(it.parent)) out.push([it.start, it.end]); }
    else out.push([it.start, it.end]);
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [s, e] of out) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) { if (e > last[1]) last[1] = e; } else merged.push([s, e]);
  }
  return merged;
}

function freeIntervals(dateStr, busy) {
  const ws = at(dateStr, settings.workStart);
  const we = at(dateStr, settings.workEnd);
  const out = [];
  let cur = ws;
  for (const [s, e] of busy) {
    if (e <= cur) continue;
    if (s >= we) break;
    if (s > cur) out.push([cur, s]);
    if (e > cur) cur = e;
  }
  if (cur < we) out.push([cur, we]);
  return out.filter(([s, e]) => minutesBetween(s, e) >= Number(settings.slotStep));
}

function availableStarts(dateStr, duration, travel, busy) {
  const ws = at(dateStr, settings.workStart);
  const we = at(dateStr, settings.workEnd);
  const step = Number(settings.slotStep) || 30;
  const buffer = Number(settings.bufferAfter) || 0;
  const now = new Date();
  const out = [];
  // Primer horario: el inicio de la jornada + el viaje, redondeado al paso.
  let s = addMin(ws, Math.ceil(travel / step) * step);
  for (; addMin(s, duration) <= we; s = addMin(s, step)) {
    if (s < now) continue;
    const a = addMin(s, -travel), b = addMin(s, duration + buffer);
    if (!busy.some(([bs, be]) => bs < b && be > a)) out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------- estado / vistas

const state = { view: 'day', date: ymd(new Date()), month: ymd(new Date()).slice(0, 7) };
let itemsById = new Map();

const views = { day: renderDay, upcoming: renderUpcoming, month: renderMonth, budgets: renderBudgets, settings: renderSettings };

async function show(view = state.view) {
  state.view = view;
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#fab').hidden = view === 'settings';
  renderAccount();
  const el = $('#view');
  el.innerHTML = '<div class="loading">Cargando…</div>';
  try {
    await views[view](el);
  } catch (e) {
    showError(e, el);
  }
}

function showError(e, el) {
  console.error(e);
  if (e instanceof AuthError) {
    el.innerHTML = `
      <div class="card center">
        <p class="big">📅</p>
        <p>${esc(e.message)}</p>
        <button class="btn primary" data-act="login">Conectar con Google</button>
      </div>`;
  } else {
    el.innerHTML = `<div class="card error"><p>⚠️ ${esc(e.message)}</p><button class="btn" data-act="retry">Reintentar</button></div>`;
  }
}

function renderAccount() {
  const acc = $('#account');
  const banner = $('#banner');
  if (backend.kind === 'local') {
    acc.innerHTML = '<span class="chip warn">Modo prueba</span>';
    banner.innerHTML = `<div class="banner">Modo prueba: las citas se guardan solo en este dispositivo.
      <button class="link" data-view-link="settings">Conectar Google Calendar</button></div>`;
  } else if (auth.valid()) {
    acc.innerHTML = '<span class="chip ok">● Google</span>';
    banner.innerHTML = '';
  } else {
    acc.innerHTML = '<button class="btn small primary" data-act="login">Conectar</button>';
    banner.innerHTML = '';
  }
}

function citaCard(it) {
  const a = it.appt;
  const wa = waLink(a);
  return `
    <article class="appt">
      <div class="appt-time"><b>${hm(it.start)}</b><span>a ${hm(it.end)}</span></div>
      <div class="appt-body">
        <h3>${esc(a.client)}</h3>
        <p class="svc">💄 ${esc(a.service)}${a.people > 1 ? ` · ${a.people} personas` : ''}${a.price !== '' ? ` · ${money(a.price)}` : ''}${a.deposit !== '' ? ` <small>(seña ${money(a.deposit)})</small>` : ''}</p>
        ${a.travel > 0 ? `<p class="leave">🚗 Salir de casa <b>${hm(it.leave)}</b> <small>(${fmtDur(a.travel)} de viaje)</small></p>` : ''}
        ${a.address ? `<p>📍 <a href="${mapsLink(a.address)}" target="_blank" rel="noopener">${esc(a.address)}</a></p>` : ''}
        ${a.notes ? `<p class="notes">📝 ${esc(a.notes)}</p>` : ''}
        <div class="actions">
          ${wa ? `<a class="btn wa small" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
          <button class="btn small" data-edit="${esc(it.id)}">Editar</button>
        </div>
      </div>
    </article>`;
}

async function renderDay(el) {
  const date = parseYmd(state.date);
  const items = await fetchDay(state.date);
  itemsById = new Map(items.map((i) => [i.id, i]));
  const citas = items.filter((i) => i.kind === 'cita');
  const citaIds = new Set(citas.map((c) => c.id));
  const others = items.filter((i) => !i.allDay && (i.kind === 'otro' || (i.kind === 'traslado' && !citaIds.has(i.parent))));
  const allDay = items.filter((i) => i.allDay);
  const busy = busyIntervals(items);
  const free = freeIntervals(state.date, busy);
  const freeMin = free.reduce((s, [a, b]) => s + minutesBetween(a, b), 0);

  const rows = [
    ...citas.map((it) => ({ t: it.leave, html: citaCard(it) })),
    ...others.map((it) => ({ t: it.start, html: `
      <article class="other"><div class="appt-time"><b>${hm(it.start)}</b><span>a ${hm(it.end)}</span></div>
      <div class="appt-body"><h3>${esc(it.title)}</h3>${it.free ? '<small>(libre)</small>' : '<small>Ocupado</small>'}</div></article>` })),
    ...free.map(([s, e]) => ({ t: s, html: `
      <button class="free" data-new="${hm(s)}">
        <span><b>Libre</b> ${hm(s)} – ${hm(e)} <small>(${fmtDur(minutesBetween(s, e))})</small></span>
        <span class="add">＋ Agendar</span>
      </button>` })),
  ].sort((a, b) => a.t - b.t);

  const firstLeave = citas.length ? citas.reduce((m, c) => (c.leave < m ? c.leave : m), citas[0].leave) : null;
  const isToday = state.date === ymd(new Date());

  el.innerHTML = `
    <div class="daynav">
      <button class="icon-btn" data-act="prev" aria-label="Día anterior">‹</button>
      <div class="daytitle">
        <h2>${fmtDay(date)}</h2>
        <div class="daytools">
          ${isToday ? '<span class="chip">Hoy</span>' : '<button class="link" data-act="today">Ir a hoy</button>'}
          <input type="date" value="${state.date}" data-act="pick" aria-label="Elegir fecha">
        </div>
      </div>
      <button class="icon-btn" data-act="next" aria-label="Día siguiente">›</button>
    </div>
    <div class="summary">
      <div><b>${citas.length}</b><span>${citas.length === 1 ? 'cita' : 'citas'}</span></div>
      <div><b>${firstLeave ? hm(firstLeave) : '—'}</b><span>primera salida</span></div>
      <div><b>${fmtDur(freeMin)}</b><span>libre</span></div>
    </div>
    ${allDay.map((i) => `<div class="allday">📌 Todo el día: ${esc(i.title)}</div>`).join('')}
    <div class="timeline">
      ${rows.length ? rows.map((r) => r.html).join('') : '<div class="card center muted">No hay horarios libres en tu jornada.</div>'}
    </div>
    <p class="hint">Jornada ${settings.workStart}–${settings.workEnd}. El tiempo libre ya descuenta los viajes y ${settings.bufferAfter} min después de cada cita.</p>`;
}

async function renderUpcoming(el) {
  const today = parseYmd(ymd(new Date()));
  const items = (await fetchRange(today, addDays(today, 120))).filter((i) => i.kind === 'cita' && i.end > new Date());
  itemsById = new Map(items.map((i) => [i.id, i]));
  const byDay = new Map();
  for (const it of items) {
    const k = ymd(it.start);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(it);
  }
  el.innerHTML = `
    <h2 class="section-title">Próximas citas <small>${items.length}</small></h2>
    ${items.length ? [...byDay].map(([day, list]) => `
      <section class="upday">
        <h3><button class="link" data-goto="${day}">${fmtDay(parseYmd(day))}</button></h3>
        ${list.map((it) => `
          <button class="uprow" data-edit="${esc(it.id)}">
            <span class="uptime">${hm(it.start)}</span>
            <span class="upmain"><b>${esc(it.appt.client)}</b> · ${esc(it.appt.service)}
              ${it.appt.travel > 0 ? `<small>🚗 salir ${hm(it.leave)}</small>` : ''}</span>
          </button>`).join('')}
      </section>`).join('') : '<div class="card center muted">No tenés citas agendadas. Tocá ＋ para agregar una.</div>'}`;
}

async function renderMonth(el) {
  const [y, m] = state.month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const next = new Date(y, m, 1);
  const items = await fetchRange(first, next);
  const counts = new Map();
  const busyDays = new Set();
  let total = 0;
  for (const it of items) {
    const k = ymd(it.start);
    if (it.kind === 'cita') {
      counts.set(k, (counts.get(k) || 0) + 1);
      total += Number(it.appt.price) || 0;
    } else if (it.kind === 'otro') busyDays.add(k);
  }
  const offset = (first.getDay() + 6) % 7; // semana empieza el lunes
  const days = minutesBetween(first, next) / 1440;
  const today = ymd(new Date());
  let cells = '';
  for (let i = 0; i < offset; i++) cells += '<span></span>';
  for (let d = 1; d <= Math.round(days); d++) {
    const k = `${y}-${pad(m)}-${pad(d)}`;
    const n = counts.get(k) || 0;
    cells += `<button class="mday${k === today ? ' today' : ''}${n ? ' has' : ''}" data-goto="${k}">
      <span>${d}</span>${n ? `<em>${n}</em>` : busyDays.has(k) ? '<i></i>' : ''}</button>`;
  }
  const citasMes = [...counts.values()].reduce((a, b) => a + b, 0);
  el.innerHTML = `
    <div class="daynav">
      <button class="icon-btn" data-act="mprev" aria-label="Mes anterior">‹</button>
      <div class="daytitle"><h2>${fmtMonth(first)}</h2></div>
      <button class="icon-btn" data-act="mnext" aria-label="Mes siguiente">›</button>
    </div>
    <div class="month">
      ${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d) => `<b>${d}</b>`).join('')}
      ${cells}
    </div>
    <p class="hint"><em class="dot"></em> número = citas del día · <i class="dot2"></i> otros eventos de tu calendario</p>
    <div class="summary">
      <div><b>${citasMes}</b><span>citas en el mes</span></div>
      <div><b>${total ? money(total) : '—'}</b><span>total del mes</span></div>
    </div>`;
}

async function renderSettings(el) {
  const s = settings;
  el.innerHTML = `
    <form id="settingsForm" class="settings">
      <section class="card">
        <h3>Google Calendar</h3>
        <label>ID de cliente de Google (OAuth)
          <input name="clientId" value="${esc(s.clientId)}" placeholder="xxxxxxxx.apps.googleusercontent.com" autocomplete="off" spellcheck="false">
        </label>
        <p class="hint">Se crea una sola vez en Google Cloud. Los pasos están en el <a href="https://github.com/gozzilola/makeup#conectar-con-google" target="_blank" rel="noopener">instructivo</a>. Si lo dejás vacío, la app queda en modo prueba.</p>
        <div id="googleBox"></div>
      </section>
      <section class="card">
        <h3>Mi jornada</h3>
        <div class="row">
          <label>Desde<input type="time" name="workStart" value="${s.workStart}"></label>
          <label>Hasta<input type="time" name="workEnd" value="${s.workEnd}"></label>
        </div>
        <div class="row">
          <label>Horarios cada (min)<input type="number" name="slotStep" min="5" step="5" value="${s.slotStep}"></label>
          <label>Descanso después de cada cita (min)<input type="number" name="bufferAfter" min="0" step="5" value="${s.bufferAfter}"></label>
        </div>
        <label>Tiempo de viaje habitual (min)<input type="number" name="defaultTravel" min="0" step="5" value="${s.defaultTravel}"></label>
        <label class="check"><input type="checkbox" name="travelEvents" ${s.travelEvents ? 'checked' : ''}> Mostrar el viaje como un evento aparte en Google Calendar ("🚗 Salir hacia…")</label>
      </section>
      <section class="card">
        <h3>Servicios</h3>
        <div id="svcList" class="svc-list"></div>
        <button type="button" class="btn small" id="addSvc">＋ Agregar servicio</button>
      </section>
      <section class="card">
        <h3>WhatsApp</h3>
        <label>Prefijo del país para los números
          <input name="waPrefix" value="${esc(s.waPrefix)}" inputmode="numeric">
        </label>
        <p class="hint">Argentina: 549 · Uruguay: 598 · Chile: 56 · México: 52 · España: 34. Si escribís el número con "+", se usa tal cual.</p>
        <label>Mensaje de confirmación
          <textarea name="waMessage" rows="3">${esc(s.waMessage)}</textarea>
        </label>
        <p class="hint">Podés usar {nombre}, {servicio}, {fecha} y {hora}.</p>
      </section>
      <section class="card">
        <h3>Presupuestos</h3>
        <label>Tu nombre o marca (va arriba del presupuesto)
          <input name="businessName" value="${esc(s.businessName)}" placeholder="Ej: Lola Makeup">
        </label>
        <label>Contacto (Instagram, teléfono…)
          <input name="businessContact" value="${esc(s.businessContact)}" placeholder="@tuinstagram · WhatsApp 11 2345 6789">
        </label>
        <div class="row">
          <label>Precio por invitada ($)<input type="number" name="guestPrice" min="0" inputmode="numeric" value="${esc(s.guestPrice)}"></label>
          <label>Seña (%)<input type="number" name="depositPct" min="0" max="100" value="${esc(s.depositPct)}"></label>
        </div>
        <label>Validez del presupuesto (días)<input type="number" name="budgetValidity" min="0" value="${esc(s.budgetValidity)}"></label>
        <label>Condiciones (aparecen al pie de cada presupuesto)
          <textarea name="budgetTerms" rows="3">${esc(s.budgetTerms)}</textarea>
        </label>
        <p class="hint">Los precios de cada servicio se toman de la lista de Servicios de arriba.</p>
      </section>
      <div class="sticky-save"><button type="submit" class="btn primary block">Guardar ajustes</button></div>
    </form>`;

  const svcList = $('#svcList', el);
  const svcRow = (sv = { name: '', duration: 60, price: '' }) => {
    const row = document.createElement('div');
    row.className = 'svc-row';
    row.innerHTML = `
      <input data-f="name" placeholder="Servicio" value="${esc(sv.name)}">
      <input data-f="duration" type="number" min="15" step="15" value="${esc(sv.duration)}" title="Duración en minutos" aria-label="Minutos">
      <input data-f="price" type="number" min="0" placeholder="$" value="${esc(sv.price)}" aria-label="Precio">
      <button type="button" class="icon-btn" aria-label="Quitar">✕</button>`;
    $('button', row).onclick = () => row.remove();
    svcList.append(row);
  };
  s.services.forEach(svcRow);
  $('#addSvc', el).onclick = () => svcRow();
  svcList.insertAdjacentHTML('beforebegin', '<div class="svc-head"><span>Nombre</span><span>Min</span><span>Precio</span><span></span></div>');

  renderGoogleBox($('#googleBox', el));

  $('#settingsForm', el).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const prevClient = settings.clientId;
    const prevCal = settings.calendarId;
    settings = {
      ...settings,
      clientId: f.get('clientId').trim(),
      calendarId: f.get('calendarId') || settings.calendarId,
      workStart: f.get('workStart') || '07:00',
      workEnd: f.get('workEnd') || '22:00',
      slotStep: Math.max(5, Number(f.get('slotStep')) || 30),
      bufferAfter: Math.max(0, Number(f.get('bufferAfter')) || 0),
      defaultTravel: Math.max(0, Number(f.get('defaultTravel')) || 0),
      travelEvents: f.get('travelEvents') === 'on',
      waPrefix: f.get('waPrefix').trim(),
      waMessage: f.get('waMessage'),
      businessName: f.get('businessName').trim(),
      businessContact: f.get('businessContact').trim(),
      guestPrice: f.get('guestPrice'),
      depositPct: Math.min(100, Math.max(0, Number(f.get('depositPct')) || 0)),
      budgetValidity: Math.max(0, Number(f.get('budgetValidity')) || 0),
      budgetTerms: f.get('budgetTerms').trim(),
      services: $$('.svc-row', svcList)
        .map((r) => ({ name: $('[data-f=name]', r).value.trim(), duration: Number($('[data-f=duration]', r).value) || 60, price: $('[data-f=price]', r).value }))
        .filter((sv) => sv.name),
    };
    saveSettings();
    if (settings.clientId !== prevClient) {
      auth.clear();
      backend = settings.clientId ? new GoogleBackend() : new LocalBackend();
    }
    if (settings.clientId !== prevClient || settings.calendarId !== prevCal) cache.clear();
    toast('Ajustes guardados ✓');
    show('settings');
  };
}

async function renderGoogleBox(box) {
  if (!settings.clientId) { box.innerHTML = ''; return; }
  if (!auth.valid()) {
    box.innerHTML = '<button type="button" class="btn primary" data-act="login">Conectar con Google</button>';
    return;
  }
  box.innerHTML = '<p class="muted">Cargando calendarios…</p>';
  try {
    const cals = await backend.calendars();
    box.innerHTML = `
      <label>Guardar las citas en el calendario
        <select name="calendarId">
          ${cals.map((c) => `<option value="${esc(c.id)}" ${c.id === settings.calendarId ? 'selected' : ''}>${esc(c.summary)}${c.primary ? ' (principal)' : ''}</option>`).join('')}
        </select>
      </label>
      <p class="ok-text">✓ Conectada con Google</p>
      <button type="button" class="btn small" data-act="logout">Desconectar</button>`;
  } catch (e) {
    box.innerHTML = `<p class="error-text">${esc(e.message)}</p>`;
  }
}

// ---------------------------------------------------------------- formulario de cita

const dlg = $('#dlg');
const form = $('#apptForm');
let editing = null;

function fillServices(selected) {
  const sel = form.service;
  const names = settings.services.map((s) => s.name);
  const opts = [...names];
  if (selected && !names.includes(selected)) opts.push(selected);
  sel.innerHTML = opts.map((n) => `<option ${n === selected ? 'selected' : ''}>${esc(n)}</option>`).join('') + '<option value="__otro">Otro…</option>';
}

function openForm({ appt = null, date = state.date, time = '', prefill = null } = {}) {
  editing = appt;
  form.reset();
  $('#dlgTitle').textContent = appt ? 'Editar cita' : 'Nueva cita';
  $('#delBtn').hidden = !appt;
  $('#otherSvcWrap').hidden = true;
  if (appt) {
    fillServices(appt.service);
    for (const k of ['client', 'whatsapp', 'duration', 'people', 'date', 'time', 'address', 'travel', 'price', 'deposit', 'notes']) {
      form[k].value = appt[k] ?? '';
    }
  } else {
    const first = settings.services[0];
    fillServices(first?.name);
    form.duration.value = first?.duration || 60;
    form.price.value = first?.price ?? '';
    form.date.value = date;
    form.time.value = time;
    form.travel.value = settings.defaultTravel;
    form.people.value = 1;
  }
  if (prefill) {
    if (prefill.service) {
      fillServices(prefill.service);
      const sv = settings.services.find((x) => x.name === prefill.service);
      if (sv) form.duration.value = sv.duration;
    }
    for (const k of ['client', 'whatsapp', 'people', 'address', 'price', 'notes']) {
      if (prefill[k] != null) form[k].value = prefill[k];
    }
  }
  dlg.showModal();
  if (!appt) setTimeout(() => form.client.focus(), 50);
  updateFormInfo();
}

form.service.addEventListener('change', () => {
  const v = form.service.value;
  $('#otherSvcWrap').hidden = v !== '__otro';
  const sv = settings.services.find((s) => s.name === v);
  if (sv) {
    form.duration.value = sv.duration;
    if (sv.price !== '' && sv.price != null) form.price.value = sv.price;
  }
  updateFormInfo();
});
for (const n of ['date', 'time', 'duration', 'travel']) form[n].addEventListener('input', () => updateFormInfo());

let infoSeq = 0;
async function updateFormInfo() {
  const seq = ++infoSeq;
  const date = form.date.value, time = form.time.value;
  const duration = Number(form.duration.value) || 60;
  const travel = Number(form.travel.value) || 0;
  const leaveBox = $('#leaveInfo'), slotsBox = $('#slots');

  if (date && time) {
    const start = at(date, time);
    leaveBox.innerHTML = travel > 0
      ? `👉 Tenés que <b>salir de casa a las ${hm(addMin(start, -travel))}</b> · terminás ${hm(addMin(start, duration))}`
      : `Terminás a las ${hm(addMin(start, duration))}`;
  } else leaveBox.innerHTML = '';

  if (!date) { slotsBox.innerHTML = ''; return; }
  try {
    const items = await fetchDay(date);
    if (seq !== infoSeq) return;
    const busy = busyIntervals(items, editing?.id);
    const starts = availableStarts(date, duration, travel, busy);
    let warn = '';
    if (time) {
      const s = at(date, time);
      const a = addMin(s, -travel), b = addMin(s, duration + (Number(settings.bufferAfter) || 0));
      if (busy.some(([bs, be]) => bs < b && be > a)) warn = '<p class="warn-text">⚠️ Ese horario se superpone con otra cita o evento (contando el viaje).</p>';
    }
    slotsBox.innerHTML = `${warn}
      <p class="slots-title">Horarios disponibles ${fmtShort(parseYmd(date))}:</p>
      ${starts.length ? `<div class="chips">${starts.map((s) => `<button type="button" class="chip-btn${hm(s) === time ? ' sel' : ''}" data-time="${hm(s)}">${hm(s)}</button>`).join('')}</div>`
        : '<p class="muted">No hay horarios libres ese día para este servicio.</p>'}`;
  } catch (e) {
    if (seq !== infoSeq) return;
    slotsBox.innerHTML = e instanceof AuthError ? '<p class="muted">Conectate con Google para ver los horarios libres.</p>' : '';
  }
}

$('#slots').addEventListener('click', (e) => {
  const b = e.target.closest('[data-time]');
  if (!b) return;
  form.time.value = b.dataset.time;
  updateFormInfo();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  let service = form.service.value === '__otro' ? form.serviceOther.value.trim() : form.service.value;
  const missing = [];
  if (!form.client.value.trim()) missing.push('clienta');
  if (!service) missing.push('servicio');
  if (!form.date.value) missing.push('fecha');
  if (!form.time.value) missing.push('hora');
  if (missing.length) { toast(`Falta completar: ${missing.join(', ')}`); return; }

  const appt = {
    id: editing?.id,
    travelEventId: editing?.travelEventId,
    client: form.client.value.trim(),
    whatsapp: form.whatsapp.value.trim(),
    service,
    duration: Math.max(15, Number(form.duration.value) || 60),
    people: Math.max(1, Number(form.people.value) || 1),
    date: form.date.value,
    time: form.time.value,
    address: form.address.value.trim(),
    travel: Math.max(0, Number(form.travel.value) || 0),
    price: form.price.value,
    deposit: form.deposit.value,
    notes: form.notes.value.trim(),
  };
  const btn = $('#saveBtn');
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  try {
    await saveAppt(appt);
    dlg.close();
    toast(backend.kind === 'google' ? 'Cita guardada en Google Calendar ✓' : 'Cita guardada ✓');
    state.date = appt.date;
    show('day');
  } catch (err) {
    console.error(err);
    if (err instanceof AuthError) { dlg.close(); renderAccount(); }
    toast(`No se pudo guardar: ${err.message}`, 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar';
  }
});

$('#delBtn').addEventListener('click', async () => {
  if (!editing || !confirm(`¿Eliminar la cita de ${editing.client}?`)) return;
  try {
    await deleteAppt(editing);
    dlg.close();
    toast('Cita eliminada');
    show();
  } catch (err) {
    toast(`No se pudo eliminar: ${err.message}`, 5000);
  }
});

$$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));

// ---------------------------------------------------------------- eventos globales

async function login() {
  try {
    await auth.login();
    cache.clear();
    toast('¡Conectada con Google! ✓');
    show();
  } catch (e) {
    toast(e.message, 5000);
  }
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act],[data-view],[data-view-link],[data-edit],[data-new],[data-goto]');
  if (!t || t.closest('dialog')) return;
  if (t.dataset.view) return show(t.dataset.view);
  if (t.dataset.viewLink) return show(t.dataset.viewLink);
  if (t.dataset.edit) {
    const it = itemsById.get(t.dataset.edit);
    if (it?.appt) openForm({ appt: it.appt });
    return;
  }
  if (t.dataset.new) return openForm({ date: state.date, time: t.dataset.new });
  if (t.dataset.goto) { state.date = t.dataset.goto; return show('day'); }
  switch (t.dataset.act) {
    case 'prev': state.date = ymd(addDays(parseYmd(state.date), -1)); return show('day');
    case 'next': state.date = ymd(addDays(parseYmd(state.date), 1)); return show('day');
    case 'today': state.date = ymd(new Date()); return show('day');
    case 'mprev': case 'mnext': {
      const [y, m] = state.month.split('-').map(Number);
      state.month = ymd(new Date(y, m - 1 + (t.dataset.act === 'mprev' ? -1 : 1), 1)).slice(0, 7);
      return show('month');
    }
    case 'login': return login();
    case 'logout': auth.logout(); cache.clear(); toast('Desconectada de Google'); return show();
    case 'retry': cache.clear(); return show();
  }
});

document.addEventListener('change', (e) => {
  if (e.target.dataset?.act === 'pick' && e.target.value) {
    state.date = e.target.value;
    state.month = state.date.slice(0, 7);
    show('day');
  }
});

$('#fab').addEventListener('click', () => {
  if (state.view === 'budgets') return newBudgetDialog();
  openForm({ date: state.view === 'day' ? state.date : ymd(new Date()) });
});

// Volver a cargar al regresar a la app (por si se cargaron citas desde Google).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('dialog[open]') && !['settings', 'budgets'].includes(state.view)) { cache.clear(); show(); }
});

initBudgets({
  getSettings: () => settings,
  openForm,
  toast,
  waNumber,
  refresh: () => { if (state.view === 'budgets') show('budgets'); },
});
auth.load();
show('day');
