import { api } from '../api.js';
import { html, str, icon, avatar, badge, ago, fmtDateTime, empty, pager, formModal, confirmBox, toast, toastErr, debounce, spinner, opts } from '../ui.js';
import { employeeForm } from './employees.js';

const TABS = [
  ['users', 'Users & Access', 'admin.users', 'users'],
  ['entities', 'Company Entities', 'admin.entities', 'building'],
  ['roles', 'Roles & Permissions', 'admin.roles', 'shield'],
  ['audit', 'Audit Log', 'admin.audit', 'history'],
];

export async function render(ctx) {
  const { el, can } = ctx;
  const tabs = TABS.filter((t) => can(t[2]));
  if (!tabs.length) { location.hash = '#/my'; return; }
  const tab = tabs.find((t) => t[0] === ctx.params[0]) || tabs[0];
  ctx.setTitle(`Admin · ${tab[1]}`);
  el.innerHTML = str(html`<div class="page-head"><div><h2>Administration</h2><p class="muted">Users, entities, roles and permissions.</p></div></div>
    <div class="seg">${tabs.map((t) => html`<a href="#/admin/${t[0]}" class="${t === tab ? 'active' : ''}">${icon(t[3], 16)} ${t[1]}</a>`)}</div>
    <div data-tab></div>`);
  const host = el.querySelector('[data-tab]');
  await ({ users, entities, roles, audit })[tab[0]](ctx, host);
}

// ---------- users ----------
async function users(ctx, host) {
  const q = { page: 1, pageSize: 25 };
  const { roles: roleList } = ctx.lookups;
  host.innerHTML = str(html`<div class="card"><div class="filters">
      <div class="search">${icon('search', 17)}<input name="q" placeholder="Search users…"></div>
      <select name="role_id"><option value="">All roles</option>${roleList.map((r) => html`<option value="${r.id}">${r.name}</option>`)}</select>
      <span class="grow"></span><button class="btn btn-primary" data-add>${icon('userPlus', 17)} New user</button></div>
    <div data-results>${spinner()}</div></div>`);
  const results = host.querySelector('[data-results]');
  const load = async () => {
    const d = await api.get(`/admin/users?${new URLSearchParams(Object.entries(q).filter(([, v]) => v)).toString()}`);
    results.innerHTML = str(html`<div class="table-wrap"><table class="table">
      <thead><tr><th>User</th><th>Entity</th><th>Role</th><th>Sign-in</th><th>Last login</th><th></th></tr></thead>
      <tbody>${d.rows.map((u) => html`<tr>
        <td><div class="cell-user">${avatar(u.full_name, 32)}<div><b>${u.full_name}</b><span class="muted small">${u.email}</span></div></div></td>
        <td class="muted">${u.entity_name || '—'}</td>
        <td><select class="inline-select" data-role="${u.id}">${roleList.map((r) => html`<option value="${r.id}" ${r.id === u.role_id ? 'selected' : ''}>${r.name}</option>`)}</select></td>
        <td>${!u.is_active ? badge('Inactive') : !u.has_password ? badge('No password', 'amber') : u.can_login ? badge('Enabled', 'green') : badge('Disabled')}</td>
        <td class="muted nowrap">${u.last_login_at ? ago(u.last_login_at) : 'Never'}</td>
        <td class="row-actions nowrap">
          <button class="btn btn-sm" data-pw="${u.id}">${icon('lock', 14)} ${u.has_password ? 'Reset' : 'Set'} password</button>
          ${u.id !== ctx.user.id ? html`<button class="btn btn-sm" data-login="${u.id}" data-val="${u.can_login ? 0 : 1}">${u.can_login ? 'Disable' : 'Enable'}</button>` : ''}
        </td></tr>`)}</tbody></table></div>${pager(d.total, d.page, d.pageSize)}`);
    results.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { q.page = +b.dataset.page; load(); }));
    results.querySelectorAll('[data-role]').forEach((s) => s.addEventListener('change', async () => {
      try { await api.put(`/admin/users/${s.dataset.role}`, { role_id: s.value }); toast('Role updated'); } catch (e) { toastErr(e); load(); }
    }));
    results.querySelectorAll('[data-login]').forEach((b) => b.addEventListener('click', async () => {
      try { await api.put(`/admin/users/${b.dataset.login}`, { can_login: b.dataset.val === '1' }); toast('Access updated'); load(); } catch (e) { toastErr(e); }
    }));
    results.querySelectorAll('[data-pw]').forEach((b) => b.addEventListener('click', () => {
      const u = d.rows.find((x) => x.id === +b.dataset.pw);
      formModal({
        title: `Set password for ${u.full_name}`, size: 'sm', submitText: 'Save password',
        fields: [{ name: 'password', label: 'New password', type: 'password', required: true, full: true, help: 'Min. 8 characters. Share it securely; the user can change it after signing in.', autocomplete: 'new-password' }],
        onSubmit: async (f, close) => { await api.post(`/admin/users/${u.id}/password`, f); toast('Password set — sign-in enabled'); close(); load(); },
      });
    }));
  };
  host.querySelector('[name=q]').addEventListener('input', debounce((e) => { q.q = e.target.value; q.page = 1; load().catch(toastErr); }));
  host.querySelector('[name=role_id]').addEventListener('change', (e) => { q.role_id = e.target.value; q.page = 1; load().catch(toastErr); });
  host.querySelector('[data-add]').addEventListener('click', () => employeeForm(ctx, null, () => load()));
  await load();
}

// ---------- entities ----------
async function entities(ctx, host) {
  const d = await api.get('/admin/entities');
  host.innerHTML = str(html`<div class="card"><div class="card-head"><h3>Company Entities <span class="count">${d.rows.length}</span></h3>
      <button class="btn btn-primary" data-add>${icon('plus', 17)} Add entity</button></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Entity</th><th>Code</th><th>Employees</th><th>Active assets</th><th>Status</th><th></th></tr></thead>
    <tbody>${d.rows.map((e) => html`<tr><td><div class="cell-asset"><span class="thumb sm">${icon('building', 16)}</span><b>${e.name}</b></div></td>
      <td class="mono">${e.code}</td><td>${e.employees}</td><td>${e.assets}</td><td>${badge(e.is_active ? 'Active' : 'Inactive')}</td>
      <td class="row-actions nowrap"><button class="icon-btn" title="Edit" data-edit="${e.id}">${icon('edit', 16)}</button>
        <button class="btn btn-sm" data-toggle="${e.id}">${e.is_active ? 'Deactivate' : 'Activate'}</button>
        ${!e.employees && !e.assets ? html`<button class="icon-btn" title="Delete" data-del="${e.id}">${icon('trash', 16)}</button>` : ''}</td></tr>`)}</tbody></table></div></div>`);
  const reload = async () => { await ctx.refreshLookups(); entities(ctx, host).catch(toastErr); };
  const form = (e) => formModal({
    title: e ? `Edit ${e.name}` : 'Add entity', size: 'sm', submitText: e ? 'Save' : 'Add entity',
    fields: [{ name: 'name', label: 'Entity name', required: true, full: true, value: e?.name }, { name: 'code', label: 'Short code', required: true, full: true, value: e?.code, help: 'e.g. ADB — used in reports' }],
    onSubmit: async (f, close) => { if (e) await api.put(`/admin/entities/${e.id}`, f); else await api.post('/admin/entities', f); toast('Entity saved'); close(); reload(); },
  });
  host.querySelector('[data-add]').addEventListener('click', () => form());
  host.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => form(d.rows.find((x) => x.id === +b.dataset.edit))));
  host.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    const e = d.rows.find((x) => x.id === +b.dataset.toggle);
    await api.put(`/admin/entities/${e.id}`, { is_active: !e.is_active }).then(reload).catch(toastErr);
  }));
  host.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const e = d.rows.find((x) => x.id === +b.dataset.del);
    if (await confirmBox('Delete entity', `Delete ${e.name}?`, { danger: true, okText: 'Delete' })) api.del(`/admin/entities/${e.id}`).then(reload).catch(toastErr);
  }));
}

// ---------- roles ----------
async function roles(ctx, host) {
  const [r, p] = await Promise.all([api.get('/admin/roles'), api.get('/admin/permissions')]);
  const modules = [...new Set(p.rows.map((x) => x.module))];
  host.innerHTML = str(html`<div class="card">
    <div class="card-head"><h3>Permission matrix</h3><div class="actions"><button class="btn" data-add>${icon('plus', 17)} New role</button>
      <button class="btn btn-primary" data-save disabled>${icon('check', 17)} Save changes</button></div></div>
    <p class="muted small pad-x">Tick what each role can do. Administrator always has full access. Users pick up changes on their next page load.</p>
    <div class="table-wrap"><table class="table matrix">
      <thead><tr><th>Permission</th>${r.rows.map((role) => html`<th class="center"><div class="role-h"><b>${role.name}</b><span class="muted small">${role.user_count} users</span>
        ${!role.is_system ? html`<button class="icon-btn" title="Delete role" data-delrole="${role.id}">${icon('trash', 14)}</button>` : ''}</div></th>`)}</tr></thead>
      <tbody>${modules.map((m) => html`<tr class="group"><td colspan="${r.rows.length + 1}">${m}</td></tr>
        ${p.rows.filter((x) => x.module === m).map((perm) => html`<tr><td><b>${perm.description}</b><span class="mono muted small"> ${perm.key}</span></td>
          ${r.rows.map((role) => html`<td class="center"><input type="checkbox" data-r="${role.id}" data-p="${perm.key}" ${role.permissions.includes(perm.key) ? 'checked' : ''} ${role.is_system ? 'disabled' : ''}></td>`)}</tr>`)}`)}
      </tbody></table></div></div>`);
  const dirty = new Set();
  const save = host.querySelector('[data-save]');
  host.querySelectorAll('input[data-r]').forEach((c) => c.addEventListener('change', () => { dirty.add(+c.dataset.r); save.disabled = false; }));
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      for (const id of dirty) {
        const perms = [...host.querySelectorAll(`input[data-r="${id}"]:checked`)].map((c) => c.dataset.p);
        await api.put(`/admin/roles/${id}`, { permissions: perms });
      }
      toast('Permissions saved'); dirty.clear();
    } catch (e) { toastErr(e); save.disabled = false; }
  });
  host.querySelector('[data-add]').addEventListener('click', () => formModal({
    title: 'New role', size: 'sm', submitText: 'Create role',
    fields: [{ name: 'name', label: 'Role name', required: true, full: true, placeholder: 'e.g. HR Officer' }, { name: 'description', label: 'Description', full: true },
      { name: 'copy', label: 'Start from', type: 'select', full: true, options: opts(r.rows), placeholder: 'No permissions' }],
    onSubmit: async (f, close) => {
      const base = r.rows.find((x) => String(x.id) === f.copy);
      await api.post('/admin/roles', { name: f.name, description: f.description, permissions: base ? base.permissions : ['dashboard.view'] });
      await ctx.refreshLookups(); toast('Role created'); close(); roles(ctx, host).catch(toastErr);
    },
  }));
  host.querySelectorAll('[data-delrole]').forEach((b) => b.addEventListener('click', async () => {
    const role = r.rows.find((x) => x.id === +b.dataset.delrole);
    if (!(await confirmBox('Delete role', `Delete the "${role.name}" role?`, { danger: true, okText: 'Delete' }))) return;
    api.del(`/admin/roles/${role.id}`).then(async () => { await ctx.refreshLookups(); toast('Role deleted'); roles(ctx, host); }).catch(toastErr);
  }));
}

// ---------- audit ----------
async function audit(ctx, host) {
  const q = { page: 1, pageSize: 50 };
  const load = async () => {
    const d = await api.get(`/admin/audit?page=${q.page}&pageSize=${q.pageSize}`);
    host.innerHTML = str(html`<div class="card">${d.rows.length ? html`<div class="table-wrap"><table class="table compact">
      <thead><tr><th>When</th><th>User</th><th>Action</th><th>Record</th><th>Details</th></tr></thead>
      <tbody>${d.rows.map((a) => html`<tr><td class="nowrap muted">${fmtDateTime(a.created_at)}</td><td>${a.full_name || '—'}</td>
        <td><span class="mono">${a.action}</span></td><td class="muted">${a.entity_type ? `${a.entity_type} #${a.entity_id}` : ''}</td>
        <td class="mono small muted ellipsis wide">${a.details ? JSON.stringify(a.details) : ''}</td></tr>`)}</tbody></table></div>${pager(d.total, d.page, d.pageSize)}`
      : empty('No activity yet', 'history')}</div>`);
    host.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { q.page = +b.dataset.page; load().catch(toastErr); }));
  };
  await load();
}
