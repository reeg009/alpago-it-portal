import { api } from '../api.js';
import { html, raw, str, icon, badge, ago, fmtNum, categoryIcon, empty } from '../ui.js';
import { skyline } from '../brand.js';
import { quickAction } from './portal.js';

const PRIO_COLORS = { Critical: '#991b1b', High: '#ef4444', Medium: '#f59e0b', Low: '#3b82f6' };

function donut(rows) {
  const order = ['Critical', 'High', 'Medium', 'Low'];
  const data = order.map((p) => ({ p, n: rows.find((r) => r.priority === p)?.n || 0 })).filter((d) => d.n || d.p !== 'Critical');
  const total = data.reduce((a, d) => a + d.n, 0);
  const R = 60; const C = 2 * Math.PI * R;
  let off = 0;
  const segs = total ? data.filter((d) => d.n).map((d) => {
    const len = (d.n / total) * C;
    const s = `<circle r="${R}" cx="80" cy="80" fill="none" stroke="${PRIO_COLORS[d.p]}" stroke-width="22" stroke-dasharray="${Math.max(0, len - 2)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 80 80)"><title>${d.p}: ${d.n}</title></circle>`;
    off += len; return s;
  }).join('') : `<circle r="${R}" cx="80" cy="80" fill="none" stroke="#e5e9f0" stroke-width="22"/>`;
  return html`<div class="donut-wrap">
    <div class="donut"><svg viewBox="0 0 160 160" width="170" height="170">${raw(segs)}</svg>
      <div class="donut-label"><b>${total}</b><span>Open</span></div></div>
    <ul class="legend">${data.map((d) => html`<li><a href="#/tickets?status=open&priority=${d.p}"><i style="background:${PRIO_COLORS[d.p]}"></i><span>${d.p}</span><b>${d.n}</b></a></li>`)}</ul>
  </div>`;
}

function kpi(ic, tone, label, k, href) {
  const up = k.change >= 0;
  return html`<a class="card kpi" href="${href}">
    <div class="kpi-ic tone-${tone}">${icon(ic, 30)}</div>
    <div><span class="kpi-label">${label}</span><b class="kpi-val">${fmtNum(k.value)}</b>
      <span class="kpi-delta ${up ? (tone === 'orange' ? 'bad' : 'good') : (tone === 'orange' ? 'good' : 'bad')}">${icon(up ? 'arrowUp' : 'arrowDown', 15)}${up ? '+' : ''}${k.change}% <em>vs last month</em></span></div>
  </a>`;
}

export async function render(ctx) {
  const { el, user, can } = ctx;
  el.innerHTML = '<div class="loading"><span class="spin"></span></div>';
  const d = await api.get('/dashboard');
  if (!ctx.alive()) return;
  ctx.setAlerts(d.alerts);
  const first = user.full_name.split(' ')[0];
  const maxCat = Math.max(1, ...d.byCategory.map((c) => c.n));
  const ticketsHref = can('tickets.view_all') ? '#/tickets?status=open' : '#/tickets?mine=requested';

  el.innerHTML = str(html`
  <section class="hero">
    ${skyline('hero-sky')}
    <div class="hero-text"><h2>Welcome back, ${first}</h2><p>Manage IT assets, support tickets, and services<br>across Alpago Group.</p></div>
    <div class="hero-ents"><h6>ALPAGO GROUP</h6><div>${ctx.lookups.entities.filter((e) => e.is_active && e.code !== 'AGR').slice(0, 4)
      .map((e) => { const [a, ...b] = e.name.split(' '); return html`<span><b>${a}</b>${b.join(' ')}</span>`; })}</div></div>
  </section>

  <section class="kpis">
    ${kpi('laptop', 'blue', 'Total Assets', d.kpis.assets, can('assets.view') ? '#/assets' : '#/my')}
    ${kpi('ticket', 'orange', d.scope === 'all' ? 'Open Tickets' : 'My Open Tickets', d.kpis.tickets, ticketsHref)}
    ${kpi('users', 'teal', 'Employees', d.kpis.employees, can('employees.view') ? '#/employees' : '#/my')}
    ${kpi('key', 'green', 'Active Licenses', d.kpis.licenses, can('licenses.view') ? '#/licenses' : '#/my')}
  </section>

  <section class="grid-3">
    <div class="card">
      <div class="card-head"><h3>Tickets Overview</h3><a class="link" href="${ticketsHref}">View All Tickets ${icon('arrowRight', 15)}</a></div>
      ${donut(d.byPriority)}
    </div>
    <div class="card">
      <div class="card-head"><h3>Assets by Category</h3>${can('assets.view') ? html`<a class="link" href="#/assets">View Assets ${icon('arrowRight', 15)}</a>` : ''}</div>
      <ul class="bars">${d.byCategory.slice(0, 6).map((c) => html`<li><a href="${can('assets.view') ? `#/assets?category=${encodeURIComponent(c.category)}` : '#/dashboard'}">
        ${icon(categoryIcon(c.category), 19)}<span>${c.category}s</span><div class="bar"><i style="width:${(c.n / maxCat) * 100}%"></i></div><b>${c.n}</b></a></li>`)}</ul>
    </div>
    <div class="card">
      <div class="card-head"><h3>Quick Actions</h3></div>
      <div class="qa-grid">
        ${qaBtn('ticket', 'blue', 'Raise a Ticket', 'incident')}
        ${qaBtn('laptop', 'green', 'Request Asset', 'asset')}
        ${qaBtn('grid', 'purple', 'Request Software', 'software')}
        ${qaBtn('alert', 'red', 'Report an Issue', 'issue')}
        ${qaBtn('swap', 'amber', 'Asset Transfer', 'transfer')}
        ${qaBtn('userPlus', 'sky', 'Onboarding Request', 'onboarding')}
      </div>
    </div>
  </section>

  <section class="grid-3 bottom">
    <div class="card tabs-card">
      <div class="tabs"><button class="tab active" data-tab="assets">My Assets</button><button class="tab" data-tab="tickets">My Tickets</button></div>
      <div data-pane="assets">${d.myAssets.length ? html`<ul class="mini-list">${d.myAssets.slice(0, 4).map((a) => html`
        <li><a href="#/assets/${a.id}"><span class="thumb">${icon(categoryIcon(a.category), 22)}</span><div><b>${a.name}</b><span>${a.category} · ${a.asset_tag}</span></div>${badge('Assigned', 'green')}</a></li>`)}</ul>`
        : empty('No equipment assigned to you', 'laptop')}
        <a class="link center-link" href="#/my">View All My Assets ${icon('arrowRight', 15)}</a></div>
      <div data-pane="tickets" hidden>${d.myTickets.length ? html`<ul class="mini-list">${d.myTickets.slice(0, 4).map((t) => html`
        <li><a href="#/tickets/${t.id}"><span class="thumb">${icon('ticket', 20)}</span><div><b>${t.subject}</b><span>${t.ticket_no} · ${ago(t.updated_at)}</span></div>${badge(t.status)}</a></li>`)}</ul>`
        : empty('You have no tickets', 'ticket')}
        <a class="link center-link" href="#/tickets?mine=requested">View All My Tickets ${icon('arrowRight', 15)}</a></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Recent Tickets</h3><a class="link" href="${ticketsHref}">View All Tickets ${icon('arrowRight', 15)}</a></div>
      ${d.recent.length ? html`<div class="table-wrap"><table class="table compact"><thead><tr><th>#</th><th>Subject</th><th>Priority</th><th>Status</th><th>Updated</th></tr></thead>
        <tbody>${d.recent.map((t) => html`<tr data-href="#/tickets/${t.id}"><td class="mono">${t.ticket_no}</td><td class="ellipsis">${t.subject}</td><td>${badge(t.priority)}</td><td>${badge(t.status)}</td><td class="nowrap muted">${ago(t.updated_at)}</td></tr>`)}</tbody></table></div>`
        : empty('No tickets yet')}
    </div>
    <div class="card">
      <div class="card-head"><h3>Upcoming &amp; Alerts</h3></div>
      ${d.alerts.length ? html`<div class="alert-list">${d.alerts.slice(0, 5).map((a) => html`<a class="alert-row lv-${a.level}" href="${a.link}">
        ${icon(a.type === 'stale' ? 'alert' : a.type === 'license' || a.type === 'seats' ? 'key' : a.type === 'warranty' ? 'calendar' : 'users', 22)}
        <div><b>${a.text}</b><span>${a.sub}</span></div>${icon('chevRight', 16)}</a>`)}</div>`
        : empty("You're all caught up", 'check')}
    </div>
  </section>`);

  el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    el.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
    el.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
  }));
  el.querySelectorAll('tr[data-href]').forEach((r) => r.addEventListener('click', () => { location.hash = r.dataset.href; }));
  el.querySelectorAll('[data-qa]').forEach((b) => b.addEventListener('click', () => quickAction(b.dataset.qa, ctx, () => ctx.reload())));
}

const qaBtn = (ic, tone, label, key) => html`<button class="qa tone-${tone}" data-qa="${key}">${icon(ic, 26)}<span>${label}</span></button>`;
