import { api, auth } from '../api.js';
import { html, str, icon, badge, avatar, fmtDate, ago, categoryIcon, empty, pager, formModal, modal, toast, toastErr, opts, debounce, spinner, fmtNum } from '../ui.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function serviceLength(doj) {
  if (!doj) return '—';
  const d = new Date(`${doj}T00:00:00`);
  const months = (new Date().getFullYear() - d.getFullYear()) * 12 + new Date().getMonth() - d.getMonth();
  if (months < 1) return 'Less than a month';
  const y = Math.floor(months / 12); const m = months % 12;
  return [y && `${y} yr${y > 1 ? 's' : ''}`, m && `${m} mo`].filter(Boolean).join(' ');
}
const age = (dob) => (dob ? Math.floor((Date.now() - new Date(`${dob}T00:00:00`)) / (365.25 * 86400000)) : null);

export function employeeForm(ctx, u, done) {
  const editing = !!u?.id;
  const adminCreate = !editing && ctx.can('admin.users');
  const managers = ctx.lookups.users.filter((x) => x.id !== u?.id).map((x) => ({ value: x.id, label: x.full_name }));
  const fields = [
    { type: 'heading', label: 'Identity & organisation' },
    { name: 'full_name', label: 'Full name', required: true, value: u?.full_name },
    { name: 'employee_code', label: 'Emp Code', value: u?.employee_code },
    { name: 'entity_id', label: 'Entity', type: 'select', options: opts(ctx.lookups.entities.filter((e) => e.is_active || e.id === u?.entity_id)), value: u?.entity_id },
    { name: 'department', label: 'Department', value: u?.department },
    { name: 'job_title', label: 'Designation', value: u?.job_title },
    { name: 'reporting_manager_id', label: 'Reporting manager', type: 'select', options: managers, value: u?.reporting_manager_id, placeholder: 'None' },
    { name: 'grade', label: 'Grade', value: u?.grade },
    { name: 'visa_sponsor', label: 'Visa (sponsor company)', value: u?.visa_sponsor },
    { name: 'nationality', label: 'Nationality', value: u?.nationality },
    { name: 'gender', label: 'Gender', type: 'select', options: ['Male', 'Female'], value: u?.gender },
    { name: 'date_of_birth', label: 'Date of birth', type: 'date', value: u?.date_of_birth },
    { name: 'is_manager', label: 'Is a manager', type: 'checkbox', value: u?.is_manager },
    { type: 'heading', label: 'Employment' },
    { name: 'date_of_joining', label: 'Date of joining', type: 'date', value: u?.date_of_joining },
    { name: 'employment_status', label: 'HR status', type: 'select', options: ['Active', 'In Active'], value: u?.employment_status || 'Active', placeholder: false },
    { name: 'probation_days', label: 'Probation days', type: 'number', min: 0, value: u?.probation_days },
    { name: 'probation_end_date', label: 'Probation end date', type: 'date', value: u?.probation_end_date },
    { name: 'probation_status', label: 'Probation status', type: 'select', options: ['Under Probation', 'Probation Completed'], value: u?.probation_status },
    { name: 'resign_type', label: 'Resign type', type: 'select', options: ['Active', 'Resigned', 'Terminated', 'Terminated Without Cause', 'End of Contract'], value: u?.resign_type },
    { name: 'resign_date', label: 'Resign date', type: 'date', value: u?.resign_date },
    { name: 'relieve_date', label: 'Relieve date', type: 'date', value: u?.relieve_date },
    { type: 'heading', label: 'Contact' },
    { name: 'email', label: 'Email', type: 'email', value: u?.email, help: 'Needed for portal sign-in' },
    { name: 'phone', label: 'Office phone', value: u?.phone },
    { name: 'phone_extension', label: 'Extension', value: u?.phone_extension },
    { name: 'phone_personal', label: 'Personal phone', value: u?.phone_personal },
    { name: 'location', label: 'Work location', value: u?.location, placeholder: 'e.g. Head Office, Site, Joinery' },
    { type: 'heading', label: 'Work schedule' },
    { name: 'weekly_off1', label: 'Weekly off 1', type: 'select', options: DAYS, value: u?.weekly_off1 },
    { name: 'weekly_off2', label: 'Weekly off 2', type: 'select', options: DAYS, value: u?.weekly_off2 },
    { name: 'shift_start', label: 'Check-in time', type: 'time', value: u?.shift_start },
    { name: 'shift_end', label: 'Check-out time', type: 'time', value: u?.shift_end },
  ];
  if (adminCreate) {
    fields.push(
      { type: 'heading', label: 'Portal access' },
      { name: 'role_id', label: 'Portal role', type: 'select', options: opts(ctx.lookups.roles), value: ctx.lookups.roles.find((r) => r.name === 'Employee')?.id, placeholder: false },
      { name: 'password', label: 'Initial password', type: 'password', help: 'Leave blank if this person should not sign in yet', autocomplete: 'new-password' },
    );
  }
  return formModal({
    title: editing ? `Edit ${u.full_name}` : 'Add Employee', size: 'lg', submitText: editing ? 'Save changes' : 'Add employee', fields,
    onSubmit: async (d, close) => {
      if (d.password && d.password.length < 8) throw new Error('Password must be at least 8 characters');
      d.is_active = d.employment_status !== 'In Active';
      if (editing && u.id === ctx.user.id) delete d.is_active;
      const r = editing ? await api.put(`/employees/${u.id}`, d) : await api.post('/employees', d);
      await ctx.refreshLookups();
      toast(editing ? 'Employee updated' : 'Employee added'); close(); done?.(r);
    },
  });
}

// ---------- HR import ----------
function importModal(ctx, done) {
  let file = null;
  const send = async (commit) => {
    const res = await fetch(`/api/employees/import${commit ? '?commit=1' : ''}`, {
      method: 'POST', headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/octet-stream' }, body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Import failed');
    return data;
  };
  const list = (title, items) => (items.length ? html`<p class="small"><b>${title}</b> (${items.length})</p><ul class="issue-list">${items.map((x) => html`<li>${x}</li>`)}</ul>` : '');
  modal({
    title: 'Import employees from HR', size: 'md',
    body: html`<div data-step>
      <p class="muted small" style="margin-bottom:12px">Upload the <b>Employee Master Detailed Report</b> (.xlsx). Employees are matched on <b>Emp Code</b>: new codes are added, existing ones updated. Portal roles and passwords are never changed.</p>
      <label class="dropzone" data-drop>${icon('download', 28)}<b data-fname>Choose or drop the .xlsx file</b><span class="small">Nothing is saved until you confirm</span>
        <input type="file" accept=".xlsx" hidden></label>
      <div class="note" style="margin-top:12px">${icon('lock', 16)}<span>Identity documents (Emirates ID, passport, visa, labour card, MOL) and payroll/bank columns are skipped and never stored.</span></div>
      <div class="form-error" hidden style="margin-top:12px"></div>
    </div>`,
    footer: html`<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-go disabled>Preview import</button>`,
    onMount: (m, close) => {
      const input = m.querySelector('input[type=file]');
      const drop = m.querySelector('[data-drop]');
      const go = m.querySelector('[data-go]');
      const err = m.querySelector('.form-error');
      const step = m.querySelector('[data-step]');
      let preview = null;
      const pick = (f) => { if (!f) return; file = f; m.querySelector('[data-fname]').textContent = f.name; go.disabled = false; err.hidden = true; };
      input.addEventListener('change', () => pick(input.files[0]));
      ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', (e) => pick(e.dataTransfer.files[0]));
      go.addEventListener('click', async () => {
        go.disabled = true; err.hidden = true;
        try {
          if (!preview) {
            go.textContent = 'Reading file…';
            preview = await send(false);
            step.innerHTML = str(html`
              <div class="stat-row">
                <div class="stat"><b>${fmtNum(preview.total)}</b><span>rows in file</span></div>
                <div class="stat"><b>${fmtNum(preview.created)}</b><span>new employees</span></div>
                <div class="stat"><b>${fmtNum(preview.updated)}</b><span>to update</span></div>
                <div class="stat"><b>${fmtNum(preview.inactive)}</b><span>inactive</span></div>
              </div>
              <p class="small" style="margin-bottom:8px"><b>By entity:</b> ${Object.entries(preview.byEntity).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>
              <p class="small" style="margin-bottom:8px"><b>${preview.noEmail}</b> employees have no usable email (they can be listed and assigned equipment, but can't sign in).</p>
              ${list('Reporting managers not found in the file', preview.unmatchedManagers)}
              ${list('Invalid emails (left blank)', preview.invalidEmails)}
              ${list('Duplicate emails (kept on first person only)', preview.duplicateEmails)}
              ${list('Email already used by another employee', preview.emailInUse)}
              ${list('Unknown entity', preview.unknownEntity)}
              <div class="note">${icon('lock', 16)}<span>Skipped: ${preview.skippedColumns}.</span></div>
              <div class="form-error" hidden style="margin-top:12px"></div>`);
            go.textContent = `Import ${fmtNum(preview.total)} employees`;
            go.disabled = false;
          } else {
            go.textContent = 'Importing…';
            const r = await send(true);
            toast(`Imported: ${r.created} added, ${r.updated} updated`);
            close(); done?.();
          }
        } catch (e) {
          const box = m.querySelector('.form-error'); box.hidden = false; box.textContent = e.message;
          go.disabled = false; go.textContent = preview ? `Import ${fmtNum(preview.total)} employees` : 'Preview import';
        }
      });
    },
  });
}

// ---------- list ----------
async function list(ctx) {
  const { el, can, lookups } = ctx;
  const q = { page: 1, pageSize: 25, active: 'true', ...ctx.query };
  el.innerHTML = str(html`
  <div class="page-head"><div><h2>Employees</h2><p class="muted">Employee master across all entities, with assigned equipment.</p></div>
    <div class="actions"><button class="btn" data-export>${icon('download', 17)} Export CSV</button>
    ${can('employees.manage') ? html`<button class="btn" data-import>${icon('file', 17)} Import from HR</button>
      <button class="btn btn-primary" data-add>${icon('userPlus', 18)} Add Employee</button>` : ''}</div></div>
  <div class="card">
    <div class="filters">
      <div class="search">${icon('search', 17)}<input name="q" placeholder="Search name, email, code, department, designation…" value="${q.q || ''}"></div>
      <select name="entity_id"><option value="">All entities</option>${lookups.entities.map((e) => html`<option value="${e.id}" ${String(e.id) === q.entity_id ? 'selected' : ''}>${e.name}</option>`)}</select>
      <select name="department"><option value="">All departments</option>${lookups.departments.map((d) => html`<option ${d === q.department ? 'selected' : ''}>${d}</option>`)}</select>
      <select name="active"><option value="true" ${q.active === 'true' ? 'selected' : ''}>Active</option><option value="false" ${q.active === 'false' ? 'selected' : ''}>Inactive</option><option value="" ${q.active === '' ? 'selected' : ''}>All</option></select>
      <select name="probation"><option value="">Any probation</option><option value="under" ${q.probation === 'under' ? 'selected' : ''}>Under probation</option></select>
      <select name="leaving"><option value="">Any</option><option value="true" ${q.leaving === 'true' ? 'selected' : ''}>Leaving (notice period)</option></select>
    </div>
    <div data-results>${spinner()}</div>
  </div>`);
  const results = el.querySelector('[data-results]');
  const load = async () => {
    const d = await api.get(`/employees?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== '')).toString()}`);
    if (!ctx.alive()) return;
    results.innerHTML = str(d.rows.length ? html`<div class="table-wrap"><table class="table">
      <thead><tr><th>Employee</th><th>Code</th><th>Entity</th><th>Department</th><th>Designation</th><th>Manager</th><th>Joined</th><th>Equipment</th><th>Status</th></tr></thead>
      <tbody>${d.rows.map((u) => html`<tr data-href="#/employees/${u.id}">
        <td><div class="cell-user">${avatar(u.full_name, 34)}<div><b>${u.full_name}</b><span class="muted small">${u.email || 'No email'}</span></div></div></td>
        <td class="mono">${u.employee_code || '—'}</td><td class="muted">${u.entity_name || '—'}</td><td>${u.department || '—'}</td>
        <td class="ellipsis">${u.job_title || '—'}</td><td class="ellipsis muted">${u.reporting_manager || '—'}</td>
        <td class="nowrap muted">${fmtDate(u.date_of_joining)}</td>
        <td>${u.asset_count ? html`<span class="pill">${icon('laptop', 14)} ${u.asset_count}</span>` : html`<span class="muted">—</span>`}</td>
        <td>${u.relieve_date && u.is_active ? badge('Leaving', 'amber') : badge(u.is_active ? 'Active' : 'Inactive')}
          ${u.probation_status?.toLowerCase().startsWith('under') && u.is_active ? badge('Probation', 'purple') : ''}</td></tr>`)}</tbody></table></div>${pager(d.total, d.page, d.pageSize)}`
      : empty('No employees found', 'users'));
    results.querySelectorAll('tr[data-href]').forEach((r) => r.addEventListener('click', () => { location.hash = r.dataset.href; }));
    results.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { q.page = +b.dataset.page; load(); }));
  };
  const reload = () => { q.page = 1; load().catch(toastErr); };
  el.querySelector('[name=q]').addEventListener('input', debounce((e) => { q.q = e.target.value; reload(); }, 300));
  el.querySelectorAll('.filters select').forEach((s) => s.addEventListener('change', () => { q[s.name] = s.value; reload(); }));
  el.querySelector('[data-add]')?.addEventListener('click', () => employeeForm(ctx, null, (r) => { location.hash = `#/employees/${r.id}`; }));
  el.querySelector('[data-import]')?.addEventListener('click', () => importModal(ctx, async () => { await ctx.refreshLookups(); ctx.reload(); }));
  el.querySelector('[data-export]').addEventListener('click', () => {
    const qs = new URLSearchParams(Object.entries(q).filter(([k, v]) => v !== '' && !['page', 'pageSize'].includes(k))).toString();
    api.download(`/employees/export.csv?${qs}`, 'alpago-employees.csv').catch(toastErr);
  });
  await load();
}

// ---------- detail ----------
async function detail(ctx, id) {
  const { el, can } = ctx;
  el.innerHTML = str(spinner());
  const u = await api.get(`/employees/${id}`);
  if (!ctx.alive()) return;
  ctx.setTitle(u.full_name);
  const refresh = () => detail(ctx, id).catch(toastErr);
  const kv = (k, v) => html`<div class="kv"><span>${k}</span><b>${v === null || v === undefined || v === '' ? '—' : v}</b></div>`;
  const a = age(u.date_of_birth);
  const offs = [u.weekly_off1, u.weekly_off2].filter(Boolean).join(' & ');
  const leaving = u.relieve_date && u.is_active;

  el.innerHTML = str(html`
  <a class="back" href="#/employees">${icon('chevLeft', 16)} Employees</a>
  <div class="page-head"><div class="title-row">${avatar(u.full_name, 60)}<div><h2>${u.full_name}</h2>
    <p class="muted">${u.job_title || 'Employee'} · ${u.department || 'No department'} · ${u.entity_name || 'No entity'}
      ${leaving ? badge('Leaving', 'amber') : badge(u.is_active ? 'Active' : 'Inactive')}
      ${u.probation_status?.toLowerCase().startsWith('under') ? badge('Under probation', 'purple') : ''}</p>
    ${u.hr_synced_at ? html`<p class="muted small">Synced from HR ${ago(u.hr_synced_at)}</p>` : ''}</div></div>
    <div class="actions">
      ${can('assets.assign') ? html`<button class="btn" data-give>${icon('laptop', 17)} Assign Asset</button>` : ''}
      ${can('employees.manage') ? html`<button class="btn btn-primary" data-edit>${icon('edit', 16)} Edit</button>` : ''}</div></div>

  ${leaving ? html`<div class="note">${icon('alert', 16)}<span><b>Leaving on ${fmtDate(u.relieve_date)}</b> (${u.resign_type || 'resigned'}). Collect assigned equipment and release licenses before this date.</span></div>` : ''}

  <div class="grid-2">
    <div class="card"><div class="card-head"><h3>Organisation</h3></div><div class="kv-grid">
      ${kv('Emp Code', u.employee_code)}${kv('Entity', u.entity_name)}
      ${kv('Department', u.department)}${kv('Designation', u.job_title)}
      ${kv('Reporting manager', u.reporting_manager_id ? html`<a href="#/employees/${u.reporting_manager_id}">${u.reporting_manager}</a>` : u.reporting_manager)}
      ${kv('Manager role', u.is_manager ? 'Yes' : 'No')}
      ${kv('Grade', u.grade === '***ALL***' ? 'Standard' : u.grade)}${kv('Visa sponsor', u.visa_sponsor)}
    </div></div>
    <div class="card"><div class="card-head"><h3>Employment</h3></div><div class="kv-grid">
      ${kv('Date of joining', fmtDate(u.date_of_joining))}${kv('Length of service', serviceLength(u.date_of_joining))}
      ${kv('Probation', u.probation_status)}${kv('Probation end', fmtDate(u.probation_end_date))}
      ${kv('HR status', u.employment_status)}${kv('Resign type', u.resign_type)}
      ${u.resign_date ? kv('Resign date', fmtDate(u.resign_date)) : ''}${u.relieve_date ? kv('Relieve date', fmtDate(u.relieve_date)) : ''}
    </div></div>
    <div class="card"><div class="card-head"><h3>Contact &amp; schedule</h3></div><div class="kv-grid">
      ${kv('Email', u.email ? html`<a href="mailto:${u.email}">${u.email}</a>` : null)}${kv('Office phone', u.phone)}
      ${kv('Extension', u.phone_extension)}${kv('Personal phone', u.phone_personal)}
      ${kv('Weekly off', offs)}${kv('Working hours', u.shift_start && u.shift_end ? `${u.shift_start} – ${u.shift_end}` : null)}
      ${kv('Work location', u.location)}${kv('ESS account', u.ess_created === null ? null : u.ess_created ? `Yes (ID ${u.ess_user_id})` : 'No')}
    </div></div>
    <div class="card"><div class="card-head"><h3>Personal &amp; portal</h3></div><div class="kv-grid">
      ${kv('Nationality', u.nationality)}${kv('Gender', u.gender)}
      ${kv('Date of birth', u.date_of_birth ? `${fmtDate(u.date_of_birth)} (${a})` : null)}${kv('Portal role', u.role_name)}
      ${kv('Last portal sign-in', u.last_login_at ? ago(u.last_login_at) : 'Never')}${kv('Software licenses', String(u.licenses.length))}
    </div></div>
  </div>

  ${u.reports.length ? html`<div class="card"><div class="card-head"><h3>Direct reports <span class="count">${u.reports.filter((r) => r.is_active).length}</span></h3></div>
    <div class="table-wrap"><table class="table compact"><tbody>${u.reports.map((r) => html`<tr data-href="#/employees/${r.id}">
      <td><div class="cell-user">${avatar(r.full_name, 28)}<b>${r.full_name}</b></div></td><td class="muted">${r.job_title || ''}</td><td>${badge(r.is_active ? 'Active' : 'Inactive')}</td></tr>`)}</tbody></table></div></div>` : ''}

  <div class="card"><div class="card-head"><h3>Assigned Equipment <span class="count">${u.assets.length}</span></h3></div>
    ${u.assets.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Asset tag</th><th>Asset</th><th>Category</th><th>Status</th><th>Since</th></tr></thead>
      <tbody>${u.assets.map((x) => html`<tr data-href="#/assets/${x.id}"><td class="mono">${x.asset_tag}</td><td><div class="cell-asset"><span class="thumb sm">${icon(categoryIcon(x.category), 16)}</span><b>${x.name}</b></div></td><td>${x.category}</td><td>${badge(x.status)}</td><td class="muted">${fmtDate(x.assigned_at)}</td></tr>`)}</tbody></table></div>`
      : empty('No equipment assigned', 'laptop')}</div>
  <div class="grid-2">
    <div class="card"><div class="card-head"><h3>Software Licenses <span class="count">${u.licenses.length}</span></h3></div>
      ${u.licenses.length ? html`<ul class="mini-list">${u.licenses.map((l) => html`<li><a href="#/licenses/${l.id}"><span class="thumb">${icon('key', 17)}</span><div><b>${l.name}</b><span>${l.vendor || ''} · since ${fmtDate(l.assigned_at)}</span></div></a></li>`)}</ul>` : empty('No licenses assigned', 'key')}</div>
    <div class="card"><div class="card-head"><h3>Recent Tickets</h3></div>
      ${u.tickets.length ? html`<div class="table-wrap"><table class="table"><tbody>${u.tickets.map((t) => html`<tr data-href="#/tickets/${t.id}"><td class="mono">${t.ticket_no}</td><td>${t.subject}</td><td>${badge(t.status)}</td><td class="muted">${ago(t.created_at)}</td></tr>`)}</tbody></table></div>`
        : empty('No tickets raised', 'ticket')}</div>
  </div>`);

  el.querySelectorAll('tr[data-href]').forEach((r) => r.addEventListener('click', () => { location.hash = r.dataset.href; }));
  el.querySelector('[data-edit]')?.addEventListener('click', () => employeeForm(ctx, u, refresh));
  el.querySelector('[data-give]')?.addEventListener('click', async () => {
    const stock = await api.get('/assets?status=In%20Stock&pageSize=200&sort=category');
    formModal({
      title: `Assign asset to ${u.full_name}`, size: 'sm', submitText: 'Assign',
      fields: [{ name: 'asset_id', label: 'Asset (in stock)', type: 'select', required: true, full: true,
        options: stock.rows.map((x) => ({ value: x.id, label: `${x.asset_tag} — ${x.name}` })), help: stock.rows.length ? '' : 'No assets in stock' },
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
