// Shared UI helpers: escaping, icons, badges, modals, toasts, tables, forms

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Tagged template that escapes interpolations unless wrapped with raw()
export const RAW = Symbol('raw');
export const raw = (s) => ({ [RAW]: true, s: String(s) });
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) out += render(vals[i]);
  });
  return raw(out);
}
function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (Array.isArray(v)) return v.map(render).join('');
  if (typeof v === 'object' && v[RAW]) return v.s;
  return esc(v);
}
export const str = (h) => (h && h[RAW] ? h.s : render(h));

// ---------- icons (Lucide-style strokes) ----------
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/>',
  monitor: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  laptop: '<rect x="4" y="4" width="16" height="11" rx="1.5"/><path d="M2 19h20l-1.5-4h-17z"/>',
  ticket: '<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="M9 6v12" stroke-dasharray="2 2"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2 2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  chevRight: '<path d="m9 18 6-6-6-6"/>',
  chevLeft: '<path d="m15 18-6-6 6-6"/>',
  arrowRight: '<path d="M5 12h14M13 5l7 7-7 7"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  arrowDown: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  swap: '<path d="M4 8h14l-4-4M20 16H6l4 4"/>',
  userPlus: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M19 8v6M22 11h-6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
  printer: '<path d="M6 9V2h12v7"/><rect x="2" y="9" width="20" height="9" rx="2"/><path d="M6 14h12v8H6z"/>',
  network: '<rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/><path d="M12 8v4M5 16v-4h14v4"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  desktop: '<rect x="3" y="3" width="18" height="12" rx="2"/><path d="M7 21h10M12 15v6"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
};
export const icon = (name, size = 20, cls = '') =>
  raw(`<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.box}</svg>`);

export const categoryIcon = (c) => ({ Laptop: 'laptop', Desktop: 'desktop', Monitor: 'monitor', Mobile: 'phone', Printer: 'printer', Network: 'network', Tablet: 'phone', Server: 'network' }[c] || 'box');

// ---------- formatting ----------
export const fmtDate = (d) => (d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtMoney = (n) => (n === null || n === undefined || n === '' ? '—' : `AED ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
export const fmtNum = (n) => Number(n || 0).toLocaleString('en-US');
export function ago(d) {
  if (!d) return '—';
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(d);
}
export const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

// ---------- badges ----------
const TONE = {
  Critical: 'red', High: 'red', Medium: 'amber', Low: 'blue',
  'Pending Approval': 'purple', Open: 'slate', Assigned: 'blue', 'In Progress': 'blue', Pending: 'amber', Resolved: 'green', Closed: 'gray', Rejected: 'red',
  'In Stock': 'slate', 'In Use': 'teal', 'In Repair': 'amber', Retired: 'gray',
  Active: 'green', Inactive: 'gray', Disabled: 'gray',
};
export const badge = (text, tone) => html`<span class="badge badge-${tone || TONE[text] || 'slate'}">${text}</span>`;
export const avatar = (name, size = 32) => html`<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px">${initials(name)}</span>`;

// ---------- toasts ----------
export function toast(msg, type = 'ok') {
  let host = document.getElementById('toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; document.body.appendChild(host); }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = str(html`${icon(type === 'error' ? 'alert' : 'check', 18)}<span>${msg}</span>`);
  host.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 3500);
}
export const toastErr = (e) => toast(e.message || String(e), 'error');

// ---------- modal ----------
export function modal({ title, body, size = 'md', onMount, footer, onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = str(html`<div class="modal modal-${size}" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${title}</h3><button class="icon-btn" data-close aria-label="Close">${icon('x', 18)}</button></div>
      <div class="modal-body">${body}</div>
      ${footer ? html`<div class="modal-foot">${footer}</div>` : ''}
    </div>`);
  let closed = false;
  const close = () => { if (closed) return; closed = true; onClose?.(); wrap.classList.add('out'); setTimeout(() => wrap.remove(), 150); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  wrap.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  document.addEventListener('keydown', onKey);
  document.body.appendChild(wrap);
  const first = wrap.querySelector('input:not([type=hidden]),select,textarea');
  if (first) setTimeout(() => first.focus(), 30);
  onMount?.(wrap.querySelector('.modal'), close);
  return close;
}

export function confirmBox(title, message, { danger = false, okText = 'Confirm' } = {}) {
  return new Promise((resolve) => {
    let ok = false;
    modal({
      title, size: 'sm', body: html`<p class="muted">${message}</p>`,
      footer: html`<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${okText}</button>`,
      onMount: (m, c) => m.querySelector('[data-ok]').addEventListener('click', () => { ok = true; c(); }),
      onClose: () => resolve(ok),
    });
  });
}

// ---------- form builder ----------
// field: { name, label, type, options:[{value,label}]|[string], required, value, placeholder, full, help, rows }
export function field(f) {
  if (f.type === 'heading') return html`<h4 class="form-section full">${f.label}</h4>`;
  const v = f.value ?? '';
  const id = `f_${f.name}`;
  let input;
  if (f.type === 'select') {
    const opts = (f.options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
    input = html`<select id="${id}" name="${f.name}" ${raw(f.required ? 'required' : '')}>
      ${f.placeholder !== false ? html`<option value="">${f.placeholder || 'Select…'}</option>` : ''}
      ${opts.map((o) => html`<option value="${o.value}" ${raw(String(o.value) === String(v) ? 'selected' : '')}>${o.label}</option>`)}
    </select>`;
  } else if (f.type === 'textarea') {
    input = html`<textarea id="${id}" name="${f.name}" rows="${f.rows || 4}" placeholder="${f.placeholder || ''}" ${raw(f.required ? 'required' : '')}>${v}</textarea>`;
  } else if (f.type === 'checkbox') {
    return html`<label class="check ${f.full ? 'full' : ''}"><input type="checkbox" name="${f.name}" ${raw(v ? 'checked' : '')}> <span>${f.label}</span></label>`;
  } else {
    input = html`<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${v}" placeholder="${f.placeholder || ''}"
      ${raw(f.required ? 'required' : '')} ${raw(f.step ? `step="${f.step}"` : '')} ${raw(f.min !== undefined ? `min="${f.min}"` : '')} ${raw(f.autocomplete ? `autocomplete="${f.autocomplete}"` : '')}>`;
  }
  return html`<div class="field ${f.full ? 'full' : ''}"><label for="${id}">${f.label}${f.required ? html`<em>*</em>` : ''}</label>${input}${f.help ? html`<small>${f.help}</small>` : ''}</div>`;
}

export const formData = (form) => {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    o[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim();
  }
  return o;
};

// open a modal containing a form; onSubmit(data) may throw to show error
export function formModal({ title, fields, submitText = 'Save', size = 'md', intro, onSubmit, onMount }) {
  return modal({
    title, size,
    body: html`<form class="form-grid" novalidate>${intro || ''}${fields.map(field)}<div class="form-error full" hidden></div><button type="submit" hidden></button></form>`,
    footer: html`<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-submit>${submitText}</button>`,
    onMount: (m, close) => {
      const form = m.querySelector('form');
      const btn = m.querySelector('[data-submit]');
      const err = m.querySelector('.form-error');
      const go = async (e) => {
        e?.preventDefault();
        const missing = [...form.querySelectorAll('[required]')].find((el) => el.type !== 'file' && !el.value.trim());
        if (missing) { err.hidden = false; err.textContent = `${missing.closest('.field').querySelector('label').textContent.replace('*', '')} is required`; missing.focus(); return; }
        btn.disabled = true; err.hidden = true;
        try { await onSubmit(formData(form), close); } catch (ex) { err.hidden = false; err.textContent = ex.message; } finally { btn.disabled = false; }
      };
      form.addEventListener('submit', go);
      btn.addEventListener('click', go);
      onMount?.(form, m);
    },
  });
}

// ---------- tables & pagination ----------
export function pager(total, page, pageSize) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return html`<div class="pager"><span class="muted">${from}–${to} of ${fmtNum(total)}</span>
    <div><button class="icon-btn" data-page="${page - 1}" ${raw(page <= 1 ? 'disabled' : '')}>${icon('chevLeft', 16)}</button>
    <span class="pg">${page} / ${pages}</span>
    <button class="icon-btn" data-page="${page + 1}" ${raw(page >= pages ? 'disabled' : '')}>${icon('chevRight', 16)}</button></div></div>`;
}

export const empty = (text, ic = 'inbox') => html`<div class="empty">${icon(ic, 36)}<p>${text}</p></div>`;
export const spinner = () => html`<div class="loading"><span class="spin"></span></div>`;

export const opts = (arr, key = 'id', label = 'name') => arr.map((x) => ({ value: x[key], label: x[label] }));

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
