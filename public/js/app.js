import { api, auth } from './api.js';
import { html, str, icon, avatar, toastErr, toast, formModal, modal, debounce } from './ui.js';
import { logo, skyline } from './brand.js';
import * as dashboard from './views/dashboard.js';
import * as assets from './views/assets.js';
import * as tickets from './views/tickets.js';
import * as employees from './views/employees.js';
import * as licenses from './views/licenses.js';
import * as portal from './views/portal.js';
import * as reports from './views/reports.js';
import * as admin from './views/admin.js';
import * as isp from './views/isp.js';

const root = document.getElementById('app');
const state = { user: null, lookups: null, alerts: [] };
const can = (p) => !!state.user?.permissions.includes(p);
const canAny = (...ps) => ps.some(can);

const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: 'home', href: '#/dashboard', show: () => can('dashboard.view') },
  { key: 'my', label: 'My Requests', icon: 'file', href: '#/my' , show: () => true },
  { key: 'assets', label: 'Assets', icon: 'monitor', show: () => can('assets.view'), children: [
    { label: 'All Assets', href: '#/assets' },
    { label: 'Tag Assets', href: '#/assets/tagging', show: () => can('assets.assign') },
    { label: 'Warranty Expiring', href: '#/assets?warranty=expiring' },
    { label: 'In Stock', href: '#/assets?status=In%20Stock' },
  ] },
  { key: 'tickets', label: 'Tickets', icon: 'ticket', show: () => true, children: [
    { label: 'All Tickets', href: '#/tickets', show: () => canAny('tickets.view_all', 'requests.approve') },
    { label: 'My Queue', href: '#/tickets?mine=assigned', show: () => can('tickets.manage') },
    { label: 'Unassigned', href: '#/tickets?status=Open&assignee_id=none', show: () => can('tickets.manage') },
    { label: 'Pending Approval', href: '#/tickets?status=Pending%20Approval', show: () => canAny('requests.approve', 'tickets.view_all') },
    { label: 'Raised by Me', href: '#/tickets?mine=requested' },
  ] },
  { key: 'licenses', label: 'Software & Licenses', icon: 'key', href: '#/licenses', show: () => can('licenses.view') },
  { key: 'isp', label: 'ISP & Telecom', icon: 'phone', href: '#/isp', show: () => can('isp.view') },
  { key: 'employees', label: 'Employees', icon: 'users', href: '#/employees', show: () => can('employees.view') },
  { key: 'reports', label: 'Reports', icon: 'chart', href: '#/reports', show: () => can('reports.view') },
  { divider: true },
  { key: 'admin', label: 'Admin', icon: 'settings', show: () => canAny('admin.users', 'admin.entities', 'admin.roles', 'admin.audit'), children: [
    { label: 'Users & Access', href: '#/admin/users', show: () => can('admin.users') },
    { label: 'Company Entities', href: '#/admin/entities', show: () => can('admin.entities') },
    { label: 'Roles & Permissions', href: '#/admin/roles', show: () => can('admin.roles') },
    { label: 'Audit Log', href: '#/admin/audit', show: () => can('admin.audit') },
  ] },
];

const ROUTES = {
  dashboard: { view: dashboard, title: 'Dashboard' },
  my: { view: portal, title: 'My Requests' },
  assets: { view: assets, title: 'Assets' },
  tickets: { view: tickets, title: 'Tickets' },
  employees: { view: employees, title: 'Employees' },
  licenses: { view: licenses, title: 'Software & Licenses' },
  reports: { view: reports, title: 'Reports' },
  isp: { view: isp, title: 'ISP & Telecom' },
  admin: { view: admin, title: 'Admin' },
};

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '') || (can('dashboard.view') ? 'dashboard' : 'my');
  const [path, qs] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  return { section: parts[0], params: parts.slice(1), query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

export const navigate = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

async function lookups(force) {
  if (!state.lookups || force) state.lookups = await api.get('/lookups');
  return state.lookups;
}

// ---------- login ----------
function loginView(msg) {
  document.title = 'Sign in · Alpago IT Portal';
  root.innerHTML = str(html`
  <div class="login">
    <div class="login-art">${skyline('login-sky')}
      <div class="login-brand">${logo()}<p>IT assets, support tickets and services<br>across Alpago Group.</p></div>
    </div>
    <div class="login-panel">
      <form class="login-form" novalidate>
        <h1>Sign in</h1>
        <p class="muted">Use your Alpago account to continue.</p>
        <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required></div>
        <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
        <div class="form-error" ${msg ? '' : 'hidden'}>${msg || ''}</div>
        <button class="btn btn-primary btn-block" type="submit">Sign in</button>
        <p class="muted small center">Forgot your password? Contact the IT team.</p>
      </form>
    </div>
  </div>`);
  const form = root.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    const err = form.querySelector('.form-error');
    btn.disabled = true;
    try {
      const { token } = await api.post('/auth/login', { email: form.email.value, password: form.password.value });
      auth.set(token);
      await boot();
    } catch (ex) {
      err.hidden = false; err.textContent = ex.message; btn.disabled = false;
    }
  });
  form.email.focus();
}

// ---------- shell ----------
function sidebar(active) {
  const items = NAV.filter((n) => n.divider || n.show());
  if (items[items.length - 1]?.divider) items.pop();
  return html`<aside class="sidebar" id="sidebar">
    <a href="#/" class="side-logo">${logo()}</a>
    <nav>${items.map((n) => {
      if (n.divider) return html`<hr>`;
      const kids = n.children?.filter((c) => !c.show || c.show());
      if (kids && kids.length) {
        const open = active.section === n.key;
        return html`<div class="nav-group ${open ? 'open' : ''}">
          <button class="nav-item ${open ? 'active-parent' : ''}" data-toggle>${icon(n.icon)}<span>${n.label}</span>${icon('chevDown', 16, 'chev')}</button>
          <div class="nav-sub">${kids.map((c) => html`<a href="${c.href}" class="${isActive(c.href) ? 'active' : ''}">${c.label}</a>`)}</div>
        </div>`;
      }
      return html`<a href="${n.href}" class="nav-item ${active.section === n.key ? 'active' : ''}">${icon(n.icon)}<span>${n.label}</span></a>`;
    })}</nav>
    <div class="side-foot">${skyline('side-sky')}<b>Alpago Group</b><span>IT &amp; Innovation Department</span></div>
  </aside>`;
}
const isActive = (href) => location.hash === href || (href === '#/tickets' && /^#\/tickets\/?$/.test(location.hash)) || (href === '#/assets' && /^#\/assets\/?$/.test(location.hash));

function topbar(title) {
  const u = state.user;
  const n = state.alerts.reduce((a, x) => a + (x.level === 'danger' ? 1 : 0), 0) || state.alerts.length;
  return html`<header class="topbar">
    <button class="icon-btn menu-btn" data-menu aria-label="Menu">${icon('menu')}</button>
    <h1 class="page-title">${title}</h1>
    <div class="gsearch">
      ${icon('search', 18)}<input id="gsearch" placeholder="Search assets, tickets, employees…" autocomplete="off"><kbd>⌘K</kbd>
      <div class="gsearch-results" hidden></div>
    </div>
    <div class="top-actions">
      <button class="icon-btn bell" data-bell aria-label="Alerts">${icon('bell', 22)}${n ? html`<i class="dot"></i>` : ''}</button>
      <button class="icon-btn" data-help aria-label="Help">${icon('help', 22)}</button>
      <div class="user-menu">
        <button class="user-btn" data-user>${avatar(u.full_name, 38)}<div><b>${u.full_name}</b><span>${u.role_name} ${icon('chevDown', 14)}</span></div></button>
        <div class="dropdown" hidden>
          <div class="dd-head"><b>${u.full_name}</b><span>${u.email}</span>${u.entity_name ? html`<span>${u.entity_name}</span>` : ''}</div>
          <button data-pw>${icon('lock', 16)} Change password</button>
          <button data-logout>${icon('logout', 16)} Sign out</button>
        </div>
      </div>
    </div>
  </header>`;
}

function bindShell() {
  root.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => b.parentElement.classList.toggle('open')));
  root.querySelector('[data-menu]').addEventListener('click', () => root.classList.toggle('nav-open'));
  root.querySelector('.scrim').addEventListener('click', () => root.classList.remove('nav-open'));

  const um = root.querySelector('.user-menu');
  um.querySelector('[data-user]').addEventListener('click', (e) => { e.stopPropagation(); um.querySelector('.dropdown').hidden ^= 1; });
  um.querySelector('[data-logout]').addEventListener('click', () => { auth.clear(); state.user = null; location.hash = ''; loginView(); });
  um.querySelector('[data-pw]').addEventListener('click', changePassword);
  document.addEventListener('click', closeDropdowns);

  root.querySelector('[data-bell]').addEventListener('click', showAlerts);
  root.querySelector('[data-help]').addEventListener('click', showHelp);

  // global search
  const inp = root.querySelector('#gsearch');
  const box = root.querySelector('.gsearch-results');
  const run = debounce(async () => {
    const q = inp.value.trim();
    if (q.length < 2) { box.hidden = true; return; }
    const enc = encodeURIComponent(q);
    const [a, t, e] = await Promise.all([
      can('assets.view') ? api.get(`/assets?q=${enc}&pageSize=5`).catch(() => null) : null,
      api.get(`/tickets?q=${enc}&pageSize=5`).catch(() => null),
      can('employees.view') ? api.get(`/employees?q=${enc}&pageSize=5`).catch(() => null) : null,
    ]);
    const sec = (title, rows, fn) => (rows?.length ? html`<div class="gs-sec"><h6>${title}</h6>${rows.map(fn)}</div>` : '');
    const body = html`${sec('Assets', a?.rows, (r) => html`<a href="#/assets/${r.id}">${icon('monitor', 16)}<span><b>${r.asset_tag}</b> ${r.name}</span></a>`)}
      ${sec('Tickets', t?.rows, (r) => html`<a href="#/tickets/${r.id}">${icon('ticket', 16)}<span><b>${r.ticket_no}</b> ${r.subject}</span></a>`)}
      ${sec('Employees', e?.rows, (r) => html`<a href="#/employees/${r.id}">${icon('user', 16)}<span><b>${r.full_name}</b> ${r.department || ''}</span></a>`)}`;
    box.innerHTML = str(body) || '<p class="muted pad">No results</p>';
    box.hidden = false;
  });
  inp.addEventListener('input', run);
  inp.addEventListener('focus', run);
  box.addEventListener('click', () => { box.hidden = true; inp.value = ''; });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Escape') { box.hidden = true; inp.blur(); } if (e.key === 'Enter') box.querySelector('a')?.click(); });
}

function closeDropdowns(e) {
  root.querySelectorAll('.dropdown').forEach((d) => { if (!d.parentElement.contains(e.target)) d.hidden = true; });
  const gs = root.querySelector('.gsearch');
  if (gs && !gs.contains(e.target)) gs.querySelector('.gsearch-results').hidden = true;
}

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); document.getElementById('gsearch')?.focus(); }
});

function showAlerts() {
  modal({
    title: 'Alerts', size: 'sm',
    body: state.alerts.length
      ? html`<div class="alert-list">${state.alerts.map((a) => html`<a class="alert-row lv-${a.level}" href="${a.link}" data-close>${icon(a.level === 'danger' ? 'alert' : a.type === 'license' ? 'key' : a.type === 'warranty' ? 'calendar' : 'users', 20)}<div><b>${a.text}</b><span>${a.sub}</span></div>${icon('chevRight', 16)}</a>`)}</div>`
      : html`<p class="muted">You're all caught up.</p>`,
  });
}

function showHelp() {
  modal({
    title: 'Help', size: 'sm',
    body: html`<div class="help">
      <p><b>Need IT support?</b> Use <a href="#/my" data-close>My Requests</a> → <i>Raise a Ticket</i>. Pick a priority that reflects business impact.</p>
      <p><b>Equipment &amp; software</b> requests go to your manager for approval first, then to the IT team.</p>
      <p><b>Shortcuts:</b> <kbd>⌘K</kbd>/<kbd>Ctrl K</kbd> focuses search, <kbd>Esc</kbd> closes dialogs.</p>
      <p class="muted small">Alpago Group · IT &amp; Innovation Department</p></div>`,
  });
}

function changePassword() {
  formModal({
    title: 'Change password', size: 'sm', submitText: 'Update password',
    fields: [
      { name: 'current', label: 'Current password', type: 'password', required: true, full: true, autocomplete: 'current-password' },
      { name: 'next', label: 'New password', type: 'password', required: true, full: true, help: 'At least 8 characters', autocomplete: 'new-password' },
      { name: 'confirm', label: 'Confirm new password', type: 'password', required: true, full: true, autocomplete: 'new-password' },
    ],
    onSubmit: async (d, close) => {
      if (d.next !== d.confirm) throw new Error('Passwords do not match');
      await api.post('/auth/change-password', d);
      toast('Password updated'); close();
    },
  });
}

// ---------- routing ----------
let routeSeq = 0;
async function route() {
  if (!state.user) return;
  const r = parseHash();
  const def = ROUTES[r.section];
  const seq = ++routeSeq;
  const title = def ? def.title : 'Not found';
  document.title = `${title} · Alpago IT Portal`;
  root.className = '';
  root.innerHTML = str(html`${sidebar(r)}<div class="scrim"></div><div class="main">${topbar(title)}<main class="content" id="view"></main></div>`);
  bindShell();
  const el = root.querySelector('#view');
  if (!def) { el.innerHTML = '<div class="card pad"><h2>Page not found</h2></div>'; return; }
  const ctx = {
    el, params: r.params, query: r.query, user: state.user, can, canAny, navigate,
    lookups: await lookups().catch(() => ({ entities: [], technicians: [], users: [], categories: [], assetStatuses: [], departments: [], roles: [] })),
    setTitle: (t) => { root.querySelector('.page-title').textContent = t; document.title = `${t} · Alpago IT Portal`; },
    setAlerts: (a) => { state.alerts = a; const b = root.querySelector('[data-bell]'); if (b && a.length && !b.querySelector('.dot')) b.insertAdjacentHTML('beforeend', '<i class="dot"></i>'); },
    reload: () => route(),
    alive: () => seq === routeSeq,
  };
  ctx.refreshLookups = async () => (ctx.lookups = await lookups(true));
  try {
    await def.view.render(ctx);
  } catch (e) {
    if (seq !== routeSeq) return;
    el.innerHTML = str(html`<div class="card pad"><h2>Something went wrong</h2><p class="muted">${e.message}</p></div>`);
    if (e.status !== 401) toastErr(e);
  }
  el.focus?.();
  window.scrollTo(0, 0);
}

async function boot() {
  if (!auth.token) return loginView();
  try {
    state.user = await api.get('/auth/me');
  } catch {
    return loginView();
  }
  state.lookups = null;
  if (can('dashboard.view')) api.get('/dashboard').then((d) => { state.alerts = d.alerts; }).catch(() => {});
  if (!location.hash || location.hash === '#/') location.hash = can('dashboard.view') ? '#/dashboard' : '#/my';
  else route();
}

window.addEventListener('hashchange', route);
window.addEventListener('auth:logout', () => { state.user = null; loginView('Your session has expired. Please sign in again.'); });
boot();

