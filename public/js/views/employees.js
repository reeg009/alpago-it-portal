import { api } from '../api.js';
import { html, str, icon, badge, avatar, fmtDate, ago, categoryIcon, empty, pager, formModal, toast, toastErr, opts, debounce, spinner } from '../ui.js';

export function employeeForm(ctx, u, done) {
  const editing = !!u?.id;
  const adminCreate = !editing && ctx.can('admin.users');
  const fields = [
    { name: 'full_name', label: 'Full name', required: true, value: u?.full_name },
    { name: 'email', label: 'Email', type: 'email', required: true, value: u?.email },
    { name: 'employee_code', label: 'Employee ID', value: u?.employee_code },
    { name: 'entity_id', label: 'Entity', type: 'select', options: opts(ctx.lookups.entities.filter((e) => e.is_active || e.id === u?.entity_id)), value: u?.entity_id },
    { name: 'department', label: 'Department', value: u?.department },
    { name: 'job_title', label: 'Job title', value: u?.job_title },
    { name: 'phone', label: 'Phone', value: u?.phone },
    { name: 'location', label: 'Location', value: u?.location },
  ];
  if (adminCreate) {
    fields.push(
      { name: 'role_id', label: 'Portal role', type: 'select', options: opts(ctx.lookups.roles), value: ctx.lookups.roles.find((r) => r.name === 'Employee')?.id, placeholder: false },
      { name: 'password', label: 'Initial password', type: 'password', help: 'Leave blank if this person should not sign in yet', autocomplete: 'new-password' },
    );
  }
  if (editing && u.id !== ctx.user.id) fields.push({ name: 'is_active', label: 'Active employee', type: 'checkbox', value: u.is_active, full: true });
  return formModal({
    title: editing ? `Edit ${u.full_name}` : 'Add Employee', size: 'lg', submitText: editing ? 'Save changes' : 'Add employee', fields,
    onSubmit: async (d, close) => {
      if (d.password && d.password.length < 8) throw new Error('Password must be at least 8 characters');
      const r = editing ? await api.put(`/employees/${u.id}`, d) : await api.post('/employees', d);
      await ctx.refreshLookups();
      toast(editing ? 'Employee updated' : 'Employee added'); close(); done?.(r);
    },
  });
}

async function list(ctx) {
  const { el, can, lookups } = ctx;
  const q = { page: 1, pageSize: 25, active: 'true', ...ctx.query };
  el.innerHTML = str(html`
  <div class="page-head"><div><h2>Employees</h2><p class="muted">Directory across all entities, with their assigned equipment.</p></div>
    <div class="actions"><button class="btn" data-export>${icon('download', 17)} Export CSV</button>
    ${can('employees.manage') ? html`<button class="btn btn-primary" data-add>${icon('userPlus', 18)} Add Employee</button>` : ''}</div></div>
  <div class="card">
    <div class="filters">
      <div class="search">${icon('search', 17)}<input name="q" placeholder="Search name, email, ID, department…" value="${q.q || ''}"></div>
      <select name="entity_id"><option value="">All entities</option>${lookups.entities.map((e) => html`<option value="${e.id}" ${String(e.id) === q.entity_id ? 'selected' : ''}>${e.name}</option>`)}</select>
      <select name="department"><option value="">All departments</option>${lookups.departments.map((d) => html`<option ${d === q.department ? 'selected' : ''}>${d}</option>`)}</select>
      <select name="active"><option value="true" ${q.active === 'true' ? 'selected' : ''}>Active</option><option value="false" ${q.active === 'false' ? 'selected' : ''}>Inactive</option><option value="" ${q.active === '' ? 'selected' : ''}>All</option></select>
    </div>
    <div data-results>${spinner()}</div>
  </div>`);
  const results = el.querySelector('[data-results]');
  const load = async () => {
    const d = await api.get(`/employees?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== '')).toString()}`);
    if (!ctx.alive()) return;
    results.innerHTML = str(d.rows.length ? html`<div class="table-wrap"><table class="table">
      <thead><tr><th>Employee</th><th>ID</th><th>Entity</th><th>Department</th><th>Job title</th><th>Equipment</th><th>Status</th></tr></thead>
      <tbody>${d.rows.map((u) => html`<tr data-href="#/employees/${u.id}">
        <td><div class="cell-user">${avatar(u.full_name, 34)}<div><b>${u.full_name}</b><span class="muted small">${u.email}</span></div></div></td>
        <td class="mono">${u.employee_code || '—'}</td><td>${u.entity_name || '—'}</td><td>${u.department || '—'}</td><td class="muted">${u.job_title || '—'}</td>
        <td>${u.asset_count ? html`<span class="pill">${icon('laptop', 14)} ${u.asset_count}</span>` : html`<span class="muted">—</span>`}</td>
        <td>${badge(u.is_active ? 'Active' : 'Inactive')}</td></tr>`)}</tbody></table></div>${pager(d.total, d.page, d.pageSize)}`
      : empty('No employees found', 'users'));
    results.querySelectorAll('tr[data-href]').forEach((r) => r.addEventListener('click', () => { location.hash = r.dataset.href; }));
    results.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { q.page = +b.dataset.page; load(); }));
  };
  const reload = () => { q.page = 1; load().catch(toastErr); };
  el.querySelector('[name=q]').addEventListener('input', debounce((e) => { q.q = e.target.value; reload(); }, 300));
  el.querySelectorAll('.filters select').forEach((s) => s.addEventListener('change', () => { q[s.name] = s.value; reload(); }));
  el.querySelector('[data-add]')?.addEventListener('click', () => employeeForm(ctx, null, (r) => { location.hash = `#/employees/${r.id}`; }));
  el.querySelector('[data-export]').addEventListener('click', () => api.download('/employees/export.csv', 'alpago-employees.csv').catch(toastErr));
  await load();
}

async function detail(ctx, id) {
  const { el, can } = ctx;
  el.innerHTML = str(spinner());
  const u = await api.get(`/employees/${id}`);
  if (!ctx.alive()) return;
  ctx.setTitle(u.full_name);
  const refresh = () => detail(ctx, id).catch(toastErr);
  const kv = (k, v) => html`<div class="kv"><span>${k}</span><b>${v || '—'}</b></div>`;

  el.innerHTML = str(html`
  <a class="back" href="#/employees">${icon('chevLeft', 16)} Employees</a>
  <div class="page-head"><div class="title-row">${avatar(u.full_name, 60)}<div><h2>${u.full_name}</h2>
    <p class="muted">${u.job_title || 'Employee'} · ${u.department || 'No department'} · ${u.entity_name || 'No entity'} ${badge(u.is_active ? 'Active' : 'Inactive')}</p></div></div>
    <div class="actions">
      ${can('assets.assign') ? html`<button class="btn" data-give>${icon('laptop', 17)} Assign Asset</button>` : ''}
      ${can('employees.manage') ? html`<button class="btn btn-primary" data-edit>${icon('edit', 16)} Edit</button>` : ''}</div></div>

  <div class="grid-2">
    <div class="card"><div class="card-head"><h3>Profile</h3></div><div class="kv-grid">
      ${kv('Email', u.email)}${kv('Phone', u.phone)}${kv('Employee ID', u.employee_code)}${kv('Location', u.location)}
      ${kv('Portal role', u.role_name)}${kv('Last sign-in', u.last_login_at ? ago(u.last_login_at) : 'Never')}</div></div>
    <div class="card"><div class="card-head"><h3>Software Licenses <span class="count">${u.licenses.length}</span></h3></div>
      ${u.licenses.length ? html`<ul class="mini-list">${u.licenses.map((l) => html`<li><a href="#/licenses/${l.id}"><span class="thumb">${icon('key', 17)}</span><div><b>${l.name}</b><span>${l.vendor || ''} · since ${fmtDate(l.assigned_at)}</span></div></a></li>`)}</ul>` : empty('No licenses assigned', 'key')}</div>
  </div>
  <div class="card"><div class="card-head"><h3>Assigned Equipment <span class="count">${u.assets.length}</span></h3></div>
    ${u.assets.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Asset tag</th><th>Asset</th><th>Category</th><th>Status</th><th>Since</th></tr></thead>
      <tbody>${u.assets.map((a) => html`<tr data-href="#/assets/${a.id}"><td class="mono">${a.asset_tag}</td><td><div class="cell-asset"><span class="thumb sm">${icon(categoryIcon(a.category), 16)}</span><b>${a.name}</b></div></td><td>${a.category}</td><td>${badge(a.status)}</td><td class="muted">${fmtDate(a.assigned_at)}</td></tr>`)}</tbody></table></div>`
      : empty('No equipment assigned', 'laptop')}</div>
  <div class="card"><div class="card-head"><h3>Recent Tickets</h3></div>
    ${u.tickets.length ? html`<div class="table-wrap"><table class="table"><tbody>${u.tickets.map((t) => html`<tr data-href="#/tickets/${t.id}"><td class="mono">${t.ticket_no}</td><td>${t.subject}</td><td>${badge(t.priority)}</td><td>${badge(t.status)}</td><td class="muted">${ago(t.created_at)}</td></tr>`)}</tbody></table></div>`
      : empty('No tickets raised', 'ticket')}</div>`);

  el.querySelectorAll('tr[data-href]').forEach((r) => r.addEventListener('click', () => { location.hash = r.dataset.href; }));
  el.querySelector('[data-edit]')?.addEventListener('click', () => employeeForm(ctx, u, refresh));
  el.querySelector('[data-give]')?.addEventListener('click', async () => {
    const stock = await api.get('/assets?status=In%20Stock&pageSize=200&sort=category');
    formModal({
      title: `Assign asset to ${u.full_name}`, size: 'sm', submitText: 'Assign',
      fields: [{ name: 'asset_id', label: 'Asset (in stock)', type: 'select', required: true, full: true,
        options: stock.rows.map((a) => ({ value: a.id, label: `${a.asset_tag} — ${a.name}` })), help: stock.rows.length ? '' : 'No assets in stock' },
        { name: 'note', label: 'Note', full: true }],
      onSubmit: async (d, close) => { await api.post(`/assets/${d.asset_id}/assign`, { user_id: u.id, note: d.note }); toast('Asset assigned'); close(); refresh(); },
    });
  });
}

export async function render(ctx) {
  if (!ctx.can('employees.view')) { location.hash = '#/my'; return; }
  if (ctx.params[0]) return detail(ctx, ctx.params[0]);
  return list(ctx);
}
