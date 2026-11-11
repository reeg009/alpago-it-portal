import { api } from '../api.js';
import { html, str, icon, fmtMoney, fmtNum, empty, spinner, toastErr } from '../ui.js';

function hbars(rows, valueKey, fmt = fmtNum) {
  if (!rows.length) return empty('No data yet', 'chart');
  const max = Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0));
  return html`<ul class="bars">${rows.map((r) => html`<li><div class="row-flat"><span>${r.label}</span><div class="bar"><i style="width:${((Number(r[valueKey]) || 0) / max) * 100}%"></i></div><b>${fmt(r[valueKey])}</b></div></li>`)}</ul>`;
}

function columns(rows) {
  if (!rows.length) return empty('No tickets in the last 6 months', 'chart');
  const max = Math.max(1, ...rows.flatMap((r) => [r.opened, r.resolved]));
  return html`<div class="cols">${rows.map((r) => html`<div class="col"><div class="col-bars">
      <i class="c1" style="height:${(r.opened / max) * 100}%" title="Opened: ${r.opened}"></i><i class="c2" style="height:${(r.resolved / max) * 100}%" title="Resolved: ${r.resolved}"></i></div>
      <span>${r.label.split(' ')[0]}</span></div>`)}</div>
    <div class="legend inline"><span><i class="c1"></i>Opened</span><span><i class="c2"></i>Resolved</span></div>`;
}

const card = (title, key, body) => html`<div class="card"><div class="card-head"><h3>${title}</h3>
  <button class="icon-btn" title="Download CSV" data-csv="${key}">${icon('download', 17)}</button></div>${body}</div>`;

export async function render(ctx) {
  const { el } = ctx;
  if (!ctx.can('reports.view')) { location.hash = '#/my'; return; }
  el.innerHTML = str(spinner());
  const d = await api.get('/reports');
  if (!ctx.alive()) return;
  const hours = (h) => (h === null ? '—' : h < 48 ? `${h} h` : `${Math.round(h / 24)} d`);
  el.innerHTML = str(html`
  <div class="page-head"><div><h2>Reports</h2><p class="muted">Inventory, helpdesk performance and software spend.</p></div></div>
  <div class="grid-2">
    ${card('Tickets opened vs resolved (6 months)', 'ticketsByMonth', columns(d.ticketsByMonth))}
    ${card('Average resolution time by priority', 'resolution', hbars(['Critical', 'High', 'Medium', 'Low'].map((p) => d.resolution.find((r) => r.label === p)).filter(Boolean), 'hours', hours))}
    ${card('Active assets by entity', 'assetsByEntity', hbars(d.assetsByEntity, 'n'))}
    ${card('Asset value by entity', 'assetsByEntity', hbars(d.assetsByEntity, 'value', fmtMoney))}
    ${card('Technician workload (open tickets)', 'byTech', hbars(d.byTech, 'open'))}
    ${card('Software spend by vendor', 'licenseCost', hbars(d.licenseCost, 'value', fmtMoney))}
    ${card('Tickets by type', 'byType', hbars(d.byType, 'n'))}
    ${card('Assets by status', 'assetsByStatus', hbars(d.assetsByStatus, 'n'))}
  </div>`);
  el.querySelectorAll('[data-csv]').forEach((b) => b.addEventListener('click', () =>
    api.download(`/reports?format=csv&report=${b.dataset.csv}`, `${b.dataset.csv}.csv`).catch(toastErr)));
}
