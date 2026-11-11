import { api } from '../api.js';
import { html, str, icon, badge, avatar, ago, fmtDateTime, empty, pager, formModal, toast, toastErr, debounce, spinner, field } from '../ui.js';
import { quickAction } from './portal.js';

let META = null;
const meta = async () => (META ||= await api.get('/tickets/meta'));

function newTicketStaff(ctx, done) {
  const users = ctx.lookups.users.map((u) => ({ value: u.id, label: u.full_name }));
  return formModal({
    title: 'New Ticket', size: 'lg', submitText: 'Create ticket',
    fields: [
      { name: 'subject', label: 'Subject', required: true, full: true },
      { name: 'requester_id', label: 'Requester', type: 'select', options: users, value: ctx.user.id, placeholder: false },
      { name: 'type', label: 'Type', type: 'select', options: META.TYPES, value: 'Incident', placeholder: false },
      { name: 'priority', label: 'Priority', type: 'select', options: META.PRIORITIES, value: 'Medium', placeholder: false },
      { name: 'category', label: 'Category', type: 'select', options: ['Hardware', 'Software', 'Email', 'Network', 'Printer', 'Accounts', 'Access', 'Phone', 'Other'] },
      { name: 'description', label: 'Description', type: 'textarea', full: true },
    ],
    onSubmit: async (d, close) => { const t = await api.post('/tickets', d); toast(`Ticket ${t.ticket_no} created`); close(); done?.(t); },
  });
}

async function list(ctx) {
  const { el, can, lookups, query } = ctx;
  await meta();
  const q = { page: 1, pageSize: 25, ...query };
  if (!can('tickets.view_all') && !can('requests.approve') && !q.mine) q.mine = 'requested';
  const titles = { requested: 'Raised by Me', assigned: 'My Queue' };
  const heading = q.status === 'Pending Approval' ? 'Pending Approval' : q.stale ? 'Unattended High-Priority' : titles[q.mine] || 'All Tickets';

  el.innerHTML = str(html`
  <div class="page-head"><div><h2>${heading}</h2><p class="muted">Helpdesk tickets and IT requests.</p></div>
    <div class="actions">${can('tickets.view_all') ? html`<button class="btn" data-export>${icon('download', 17)} Export CSV</button>` : ''}
      <button class="btn btn-primary" data-new>${icon('plus', 18)} New Ticket</button></div></div>
  <div class="card">
    <div class="filters">
      <div class="search">${icon('search', 17)}<input name="q" placeholder="Search ticket #, subject, requester…" value="${q.q || ''}"></div>
      <select name="status"><option value="">All statuses</option><option value="open" ${q.status === 'open' ? 'selected' : ''}>All open</option>
        ${META.STATUSES.map((s) => html`<option ${s === q.status ? 'selected' : ''}>${s}</option>`)}</select>
      <select name="priority"><option value="">All priorities</option>${META.PRIORITIES.map((s) => html`<option ${s === q.priority ? 'selected' : ''}>${s}</option>`)}</select>
      <select name="type"><option value="">All types</option>${META.TYPES.map((s) => html`<option ${s === q.type ? 'selected' : ''}>${s}</option>`)}</select>
      ${can('tickets.view_all') ? html`<select name="assignee_id"><option value="">Any technician</option><option value="none" ${q.assignee_id === 'none' ? 'selected' : ''}>Unassigned</option>
        ${lookups.technicians.map((t) => html`<option value="${t.id}" ${String(t.id) === q.assignee_id ? 'selected' : ''}>${t.full_name}</option>`)}</select>` : ''}
    </div>
    <div data-results>${spinner()}</div>
  </div>`);

  const results = el.querySelector('[data-results]');
  const load = async () => {
    const clean = Object.entries(q).filter(([, v]) => v !== '' && v !== undefined);
    history.replaceState(null, '', `#/tickets?${new URLSearchParams(clean.filter(([k, v]) => k !== 'pageSize' && !(k === 'page' && v == 1))).toString()}`);
    const d = await api.get(`/tickets?${new URLSearchParams(clean).toString()}`);
    if (!ctx.alive()) return;
    results.innerHTML = str(d.rows.length ? html`<div class="table-wrap"><table class="table">
      <thead><tr><th>#</th><th>Subject</th><th>Requester</th><th>Type</th><th>Priority</th><th>Status</th><th>Assignee</th><th>Updated</th></tr></thead>
      <tbody>${d.rows.map((t) => html`<tr data-href="#/tickets/${t.id}">
        <td class="mono nowrap">${t.ticket_no}</td><td class="ellipsis wide"><b>${t.subject}</b></td><td>${t.requester_name || '—'}</td>
        <td class="muted nowrap">${t.type}</td><td>${badge(t.priority)}</td><td>${badge(t.status)}</td>
        <td>${t.assignee_name || html`<span class="muted">Unassigned</span>`}</td><td class="nowrap muted">${ago(t.updated_at)}</td></tr>`)}</tbody></table></div>
      ${pager(d.total, d.page, d.pageSize)}` : empty('No tickets found', 'ticket'));
    results.querySelectorAll('tr[data-href]').forEach((r) => r.addEventListener('click', () => { location.hash = r.dataset.href; }));
    results.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { q.page = +b.dataset.page; load(); }));
  };
  const reload = () => { q.page = 1; load().catch(toastErr); };
  el.querySelector('[name=q]').addEventListener('input', debounce((e) => { q.q = e.target.value; reload(); }, 300));
  el.querySelectorAll('.filters select').forEach((s) => s.addEventListener('change', () => { q[s.name] = s.value; delete q.stale; reload(); }));
  el.querySelector('[data-new]').addEventListener('click', () => {
    const done = (t) => { location.hash = `#/tickets/${t.id}`; };
    if (can('tickets.manage')) newTicketStaff(ctx, done); else quickAction('incident', ctx, done);
  });
  el.querySelector('[data-export]')?.addEventListener('click', () => {
    const qs = new URLSearchParams(Object.entries(q).filter(([k, v]) => v && !['page', 'pageSize'].includes(k))).toString();
    api.download(`/tickets/export.csv?${qs}`, 'alpago-tickets.csv').catch(toastErr);
  });
  await load();
}

async function detail(ctx, id) {
  const { el, can, user, lookups } = ctx;
  await meta();
  el.innerHTML = str(spinner());
  const t = await api.get(`/tickets/${id}`);
  if (!ctx.alive()) return;
  ctx.setTitle(t.ticket_no);
  const refresh = () => detail(ctx, id).catch(toastErr);
  const manage = can('tickets.manage');
  const isReq = t.requester_id === user.id;
  const pending = t.status === 'Pending Approval';
  const canDecide = pending && can('requests.approve') && (!isReq || can('admin.roles'));
  const closed = ['Resolved', 'Closed', 'Rejected'].includes(t.status);
  const statusOpts = META.STATUSES.filter((s) => !['Pending Approval', 'Rejected'].includes(s));

  el.innerHTML = str(html`
  <a class="back" href="#/tickets">${icon('chevLeft', 16)} Tickets</a>
  <div class="page-head"><div><p class="muted mono">${t.ticket_no} · ${t.type}</p><h2>${t.subject}</h2>
    <p class="badges">${badge(t.status)} ${badge(t.priority)} ${t.category ? badge(t.category, 'slate') : ''}</p></div>
    <div class="actions">
      ${canDecide ? html`<button class="btn btn-ghost-danger" data-reject>${icon('x', 16)} Reject</button><button class="btn btn-success" data-approve>${icon('check', 16)} Approve</button>` : ''}
      ${!manage && isReq && t.status === 'Resolved' ? html`<button class="btn" data-reopen>Reopen</button><button class="btn btn-primary" data-close-ticket>${icon('check', 16)} Confirm resolved</button>` : ''}
      ${!manage && isReq && t.status === 'Closed' ? html`<button class="btn" data-reopen>Reopen</button>` : ''}
      ${manage && !pending && !closed ? html`<button class="btn btn-success" data-resolve>${icon('check', 16)} Mark resolved</button>` : ''}
    </div></div>

  <div class="ticket-layout">
    <div class="card convo">
      <div class="msg first">${avatar(t.requester_name, 36)}<div class="bubble"><div class="msg-head"><b>${t.requester_name || 'Unknown'}</b><span class="muted small">${fmtDateTime(t.created_at)}</span></div>
        <p class="pre">${t.description || 'No description provided.'}</p></div></div>
      ${t.comments.filter((c) => !c.is_system || c.body !== 'Ticket created').map((c) => c.is_system
        ? html`<div class="sys">${icon('history', 14)} <span>${c.body}</span> <em>${c.author_name ? `${c.author_name} · ` : ''}${ago(c.created_at)}</em></div>`
        : html`<div class="msg ${c.user_id === user.id ? 'mine' : ''} ${c.is_internal ? 'internal' : ''}">${avatar(c.author_name, 36)}<div class="bubble">
            <div class="msg-head"><b>${c.author_name || 'Unknown'}</b>${c.is_internal ? badge('Internal note', 'amber') : ''}<span class="muted small">${fmtDateTime(c.created_at)}</span></div>
            <p class="pre">${c.body}</p></div></div>`)}
      ${t.status === 'Rejected' ? '' : html`<form class="reply">
        <textarea name="body" rows="3" placeholder="${manage ? 'Reply to the requester or add a note…' : 'Add a comment…'}" required></textarea>
        <div class="reply-foot">${can('tickets.internal_notes') ? html`<label class="check"><input type="checkbox" name="internal"> <span>Internal note (hidden from requester)</span></label>` : html`<span></span>`}
          <button class="btn btn-primary" type="submit">${icon('message', 16)} Comment</button></div></form>`}
    </div>

    <aside class="card props">
      <h3>Properties</h3>
      ${manage && !pending ? html`<form class="prop-form">
        ${field({ name: 'status', label: 'Status', type: 'select', options: statusOpts, value: t.status, placeholder: false, full: true })}
        ${field({ name: 'priority', label: 'Priority', type: 'select', options: META.PRIORITIES, value: t.priority, placeholder: false, full: true })}
        ${field({ name: 'assignee_id', label: 'Assigned technician', type: 'select', options: lookups.technicians.map((x) => ({ value: x.id, label: x.full_name })), value: t.assignee_id, placeholder: 'Unassigned', full: true })}
        ${field({ name: 'category', label: 'Category', type: 'select', options: ['Hardware', 'Software', 'Email', 'Network', 'Printer', 'Accounts', 'Access', 'Phone', 'Other'], value: t.category, full: true })}
        ${t.assignee_id !== user.id ? html`<button type="button" class="btn btn-sm btn-block" data-take>${icon('userPlus', 15)} Assign to me</button>` : ''}
      </form>` : html`<div class="kv-list">
        <div class="kv"><span>Status</span><b>${badge(t.status)}</b></div>
        <div class="kv"><span>Priority</span><b>${badge(t.priority)}</b></div>
        <div class="kv"><span>Assigned to</span><b>${t.assignee_name || 'Not yet assigned'}</b></div></div>`}
      <div class="kv-list">
        <div class="kv"><span>Requester</span><b>${t.requester_name || '—'}</b><small class="muted">${t.requester_email || ''}</small></div>
        <div class="kv"><span>Entity</span><b>${t.entity_name || '—'}</b></div>
        ${t.asset_id ? html`<div class="kv"><span>Related asset</span><b><a href="#/assets/${t.asset_id}">${t.asset_tag}</a></b><small class="muted">${t.asset_name}</small></div>` : ''}
        <div class="kv"><span>Created</span><b>${fmtDateTime(t.created_at)}</b></div>
        <div class="kv"><span>Last update</span><b>${ago(t.updated_at)}</b></div>
        ${t.resolved_at ? html`<div class="kv"><span>Resolved</span><b>${fmtDateTime(t.resolved_at)}</b></div>` : ''}
      </div>
    </aside>
  </div>`);

  const patch = async (body, msg) => {
    try { const r = await api.patch(`/tickets/${t.id}`, body); if (r.changes?.length) toast(msg || r.changes.join(' · ')); refresh(); } catch (e) { toastErr(e); refresh(); }
  };
  el.querySelectorAll('.prop-form select').forEach((s) => s.addEventListener('change', () => patch({ [s.name]: s.value })));
  el.querySelector('[data-take]')?.addEventListener('click', () => patch({ assignee_id: user.id, ...(t.status === 'Open' ? { status: 'In Progress' } : {}) }));
  el.querySelector('[data-resolve]')?.addEventListener('click', () => patch({ status: 'Resolved' }));
  el.querySelector('[data-close-ticket]')?.addEventListener('click', () => patch({ status: 'Closed' }, 'Thanks — ticket closed'));
  el.querySelector('[data-reopen]')?.addEventListener('click', () => patch({ status: 'Open' }, 'Ticket reopened'));
  const decide = (approve) => formModal({
    title: approve ? 'Approve request' : 'Reject request', size: 'sm', submitText: approve ? 'Approve' : 'Reject',
    fields: [{ name: 'note', label: approve ? 'Comment (optional)' : 'Reason', type: 'textarea', rows: 3, full: true, required: !approve }],
    onSubmit: async (d, close) => { await api.post(`/tickets/${t.id}/${approve ? 'approve' : 'reject'}`, d); toast(approve ? 'Request approved' : 'Request rejected'); close(); refresh(); },
  });
  el.querySelector('[data-approve]')?.addEventListener('click', () => decide(true));
  el.querySelector('[data-reject]')?.addEventListener('click', () => decide(false));
  const form = el.querySelector('form.reply');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = form.body.value.trim();
    if (!body) return;
    form.querySelector('button').disabled = true;
    try { await api.post(`/tickets/${t.id}/comments`, { body, is_internal: form.internal?.checked }); refresh(); } catch (ex) { toastErr(ex); form.querySelector('button').disabled = false; }
  });
}

export async function render(ctx) {
  if (ctx.params[0]) return detail(ctx, ctx.params[0]);
  return list(ctx);
}
