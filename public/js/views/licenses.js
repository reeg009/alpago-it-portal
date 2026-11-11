import { api } from '../api.js';
import { html, str, icon, avatar, badge, fmtDate, fmtMoney, empty, formModal, confirmBox, toast, toastErr, opts, debounce, spinner } from '../ui.js';

function licenseForm(ctx, l, done) {
  const editing = !!l?.id;
  return formModal({
    title: editing ? `Edit ${l.name}` : 'Add License', size: 'lg', submitText: editing ? 'Save changes' : 'Add license',
    fields: [
      { name: 'name', label: 'Product name', required: true, full: true, value: l?.name, placeholder: 'e.g. Microsoft 365 Business Premium' },
      { name: 'vendor', label: 'Vendor', value: l?.vendor },
      { name: 'license_type', label: 'License type', type: 'select', placeholder: false, options: ['Subscription', 'Perpetual', 'Volume', 'Open Source', 'Trial'], value: l?.license_type || 'Subscription' },
      { name: 'seats_total', label: 'Seats', type: 'number', min: 1, required: true, value: l?.seats_total ?? 1 },
      { name: 'billing_cycle', label: 'Billing cycle', type: 'select', placeholder: false, options: ['Monthly', 'Annual', 'One-time'], value: l?.billing_cycle || 'Annual' },
      { name: 'cost', label: 'Cost per cycle (AED)', type: 'number', step: '0.01', value: l?.cost },
      { name: 'entity_id', label: 'Billed to entity', type: 'select', options: opts(ctx.lookups.entities), value: l?.entity_id },
      { name: 'purchase_date', label: 'Purchase date', type: 'date', value: l?.purchase_date },
      { name: 'renewal_date', label: 'Renewal / expiry date', type: 'date', value: l?.renewal_date },
      { name: 'license_key', label: 'License key / account ref', full: true, value: l?.license_key },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 3, full: true, value: l?.notes },
    ],
    onSubmit: async (d, close) => {
      const r = editing ? await api.put(`/licenses/${l.id}`, d) : await api.post('/licenses', d);
      toast(editing ? 'License updated' : 'License added'); close(); done?.(r);
    },
  });
}

const renewTone = (days) => (days === null || days === undefined ? 'slate' : days < 0 ? 'red' : days <= 30 ? 'amber' : 'green');
const renewText = (days) => (days === null || days === undefined ? 'No date' : days < 0 ? `Expired ${-days}d ago` : days === 0 ? 'Renews today' : `${days} days`);

async function list(ctx) {
  const { el, can } = ctx;
  const q = { ...ctx.query };
  el.innerHTML = str(html`
  <div class="page-head"><div><h2>Software &amp; Licenses</h2><p class="muted">Subscriptions, seat usage and renewals.</p></div>
    ${can('licenses.manage') ? html`<button class="btn btn-primary" data-add>${icon('plus', 18)} Add License</button>` : ''}</div>
  <div class="card"><div class="filters">
    <div class="search">${icon('search', 17)}<input name="q" placeholder="Search product or vendor…" value="${q.q || ''}"></div>
    <select name="renewing"><option value="">All licenses</option><option value="30" ${q.renewing === '30' ? 'selected' : ''}>Renewing in 30 days</option></select>
  </div><div data-results>${spinner()}</div></div>`);
  const results = el.querySelector('[data-results]');
  const load = async () => {
    const d = await api.get(`/licenses?${new URLSearchParams(Object.entries(q).filter(([, v]) => v)).toString()}`);
    if (!ctx.alive()) return;
    const totalCost = d.rows.reduce((a, l) => a + Number(l.cost || 0), 0);
    results.innerHTML = str(d.rows.length ? html`<div class="table-wrap"><table class="table">
      <thead><tr><th>Product</th><th>Type</th><th>Seat usage</th><th>Cost</th><th>Renewal</th><th></th></tr></thead>
      <tbody>${d.rows.map((l) => { const pct = Math.min(100, (l.seats_used / Math.max(1, l.seats_total)) * 100); return html`<tr data-href="#/licenses/${l.id}">
        <td><div class="cell-asset"><span class="thumb sm">${icon('key', 16)}</span><div><b>${l.name}</b><span class="muted small">${l.vendor || ''}${l.entity_name ? ` · ${l.entity_name}` : ''}</span></div></div></td>
        <td class="muted">${l.license_type}</td>
        <td><div class="seat"><div class="bar ${pct >= 100 ? 'full' : pct >= 85 ? 'warn' : ''}"><i style="width:${pct}%"></i></div><span>${l.seats_used} / ${l.seats_total}</span></div></td>
        <td class="nowrap">${fmtMoney(l.cost)} <span class="muted small">${l.billing_cycle ? `/ ${l.billing_cycle.toLowerCase()}` : ''}</span></td>
        <td class="nowrap">${fmtDate(l.renewal_date)} ${badge(renewText(l.days_to_renewal), renewTone(l.days_to_renewal))}</td>
        <td>${icon('chevRight', 16)}</td></tr>`; })}</tbody></table></div>
      <div class="pager"><span class="muted">${d.rows.length} licenses</span><span class="muted">Total recurring: <b>${fmtMoney(totalCost)}</b></span></div>`
      : empty('No licenses found', 'key'));
    results.querySelectorAll('tr[data-href]').forEach((r) => r.addEventListener('click', () => { location.hash = r.dataset.href; }));
  };
  el.querySelector('[name=q]').addEventListener('input', debounce((e) => { q.q = e.target.value; load().catch(toastErr); }, 300));
  el.querySelector('[name=renewing]').addEventListener('change', (e) => { q.renewing = e.target.value; load().catch(toastErr); });
  el.querySelector('[data-add]')?.addEventListener('click', () => licenseForm(ctx, null, (r) => { location.hash = `#/licenses/${r.id}`; }));
  await load();
}

async function detail(ctx, id) {
  const { el, can } = ctx;
  el.innerHTML = str(spinner());
  const l = await api.get(`/licenses/${id}`);
  if (!ctx.alive()) return;
  ctx.setTitle(l.name);
  const refresh = () => detail(ctx, id).catch(toastErr);
  const manage = can('licenses.manage');
  const free = l.seats_total - l.seats_used;
  const kv = (k, v) => html`<div class="kv"><span>${k}</span><b>${v || '—'}</b></div>`;

  el.innerHTML = str(html`
  <a class="back" href="#/licenses">${icon('chevLeft', 16)} Licenses</a>
  <div class="page-head"><div class="title-row"><span class="thumb lg">${icon('key', 28)}</span><div><h2>${l.name}</h2>
    <p class="muted">${l.vendor || ''} · ${l.license_type} ${badge(renewText(l.days_to_renewal), renewTone(l.days_to_renewal))}</p></div></div>
    ${manage ? html`<div class="actions"><button class="btn btn-ghost-danger" data-del>${icon('trash', 16)} Delete</button><button class="btn" data-edit>${icon('edit', 16)} Edit</button>
      <button class="btn btn-primary" data-assign ${free <= 0 ? 'disabled' : ''}>${icon('userPlus', 17)} Assign seat</button></div>` : ''}</div>
  <div class="grid-2">
    <div class="card"><div class="card-head"><h3>Details</h3></div><div class="kv-grid">
      ${kv('Seats', `${l.seats_used} used of ${l.seats_total} (${free} free)`)}${kv('Cost', `${fmtMoney(l.cost)} / ${(l.billing_cycle || '').toLowerCase()}`)}
      ${kv('Billed to', l.entity_name)}${kv('Purchase date', fmtDate(l.purchase_date))}
      ${kv('Renewal date', fmtDate(l.renewal_date))}${kv('License key / ref', l.license_key)}</div>
      ${l.notes ? html`<div class="notes"><h6>Notes</h6><p>${l.notes}</p></div>` : ''}</div>
    <div class="card"><div class="card-head"><h3>Assigned Users <span class="count">${l.users.length}</span></h3></div>
      ${l.users.length ? html`<ul class="mini-list">${l.users.map((u) => html`<li><div class="row-flat">${avatar(u.full_name, 32)}<div class="grow"><b>${u.full_name}</b><span>${u.department || u.email}</span></div>
        ${manage ? html`<button class="icon-btn" title="Remove seat" data-unassign="${u.id}">${icon('x', 16)}</button>` : ''}</div></li>`)}</ul>` : empty('No seats assigned', 'users')}</div>
  </div>`);

  el.querySelector('[data-edit]')?.addEventListener('click', () => licenseForm(ctx, l, refresh));
  el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!(await confirmBox('Delete license', `Delete ${l.name} and its ${l.users.length} seat assignments?`, { danger: true, okText: 'Delete' }))) return;
    api.del(`/licenses/${l.id}`).then(() => { toast('License deleted'); location.hash = '#/licenses'; }).catch(toastErr);
  });
  el.querySelector('[data-assign]')?.addEventListener('click', () => {
    const taken = new Set(l.users.map((u) => u.id));
    formModal({
      title: `Assign ${l.name}`, size: 'sm', submitText: 'Assign seat',
      fields: [{ name: 'user_id', label: 'Employee', type: 'select', required: true, full: true,
        options: ctx.lookups.users.filter((u) => !taken.has(u.id)).map((u) => ({ value: u.id, label: `${u.full_name}${u.department ? ` — ${u.department}` : ''}` })) }],
      onSubmit: async (d, close) => { await api.post(`/licenses/${l.id}/assign`, d); toast('Seat assigned'); close(); refresh(); },
    });
  });
  el.querySelectorAll('[data-unassign]').forEach((b) => b.addEventListener('click', async () => {
    await api.del(`/licenses/${l.id}/assign/${b.dataset.unassign}`).then(() => { toast('Seat released'); refresh(); }).catch(toastErr);
  }));
}

export async function render(ctx) {
  if (!ctx.can('licenses.view')) { location.hash = '#/my'; return; }
  if (ctx.params[0]) return detail(ctx, ctx.params[0]);
  return list(ctx);
}
