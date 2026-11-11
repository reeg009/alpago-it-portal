// Employee self-service portal + quick-action request forms
import { api } from '../api.js';
import { html, str, icon, badge, ago, fmtDate, categoryIcon, empty, formModal, toast, opts } from '../ui.js';

const PRIORITY = [
  { value: 'Low', label: 'Low — minor inconvenience' },
  { value: 'Medium', label: 'Medium — work is affected' },
  { value: 'High', label: 'High — cannot work' },
  { value: 'Critical', label: 'Critical — business stopped' },
];
const CATS = ['Hardware', 'Software', 'Email', 'Network', 'Printer', 'Accounts', 'Access', 'Phone', 'Other'];

async function myAssets() {
  try { return (await api.get('/me/overview')).assets; } catch { return []; }
}

export async function quickAction(kind, ctx, done, preset = {}) {
  const submit = async (payload, close) => {
    const t = await api.post('/tickets', payload);
    close();
    toast(t.status === 'Pending Approval' ? `${t.ticket_no} submitted for approval` : `Ticket ${t.ticket_no} created`);
    done?.(t);
  };
  const mine = await myAssets();
  const assetOpts = mine.map((a) => ({ value: a.id, label: `${a.asset_tag} — ${a.name}` }));

  if (kind === 'incident' || kind === 'issue') {
    return formModal({
      title: kind === 'issue' ? 'Report an Issue' : 'Raise a Ticket', submitText: 'Submit ticket',
      fields: [
        { name: 'subject', label: 'Subject', required: true, full: true, placeholder: 'e.g. Laptop running slow', value: preset.subject },
        { name: 'category', label: 'Category', type: 'select', options: CATS, value: preset.category || (kind === 'issue' ? 'Hardware' : '') },
        { name: 'priority', label: 'Priority', type: 'select', options: PRIORITY, value: 'Medium', placeholder: false },
        { name: 'asset_id', label: 'Related equipment', type: 'select', options: assetOpts, value: preset.asset_id, placeholder: 'None', full: true },
        { name: 'description', label: 'Description', type: 'textarea', full: true, placeholder: 'What happened? Any error messages? Since when?' },
      ],
      onSubmit: (d, close) => submit({ ...d, type: 'Incident' }, close),
    });
  }
  if (kind === 'asset') {
    return formModal({
      title: 'Request Asset', submitText: 'Submit for approval',
      intro: html`<p class="muted full small">Equipment requests are sent to a manager for approval before IT fulfils them.</p>`,
      fields: [
        { name: 'item', label: 'Item needed', type: 'select', required: true, options: ['Laptop', 'Desktop', 'Monitor', 'Mobile', 'Keyboard / Mouse', 'Headset', 'Docking Station', 'Printer', 'Other'] },
        { name: 'qty', label: 'Quantity', type: 'number', value: 1, min: 1 },
        { name: 'needed_by', label: 'Needed by', type: 'date' },
        { name: 'priority', label: 'Priority', type: 'select', options: PRIORITY, value: 'Medium', placeholder: false },
        { name: 'reason', label: 'Business justification', type: 'textarea', required: true, full: true },
      ],
      onSubmit: (d, close) => submit({
        type: 'Asset Request', category: 'Hardware', priority: d.priority,
        subject: `Asset request: ${d.qty > 1 ? `${d.qty} × ` : ''}${d.item}`,
        description: `Item: ${d.item}\nQuantity: ${d.qty || 1}\nNeeded by: ${d.needed_by || 'n/a'}\n\n${d.reason}`,
      }, close),
    });
  }
  if (kind === 'software') {
    return formModal({
      title: 'Request Software', submitText: 'Submit for approval',
      intro: html`<p class="muted full small">Software and license requests need manager approval.</p>`,
      fields: [
        { name: 'software', label: 'Software / license', required: true, full: true, placeholder: 'e.g. Adobe Acrobat Pro, AutoCAD, Visio' },
        { name: 'duration', label: 'Needed for', type: 'select', options: ['Permanent', '1 month', '3 months', '6 months', 'Project duration'], value: 'Permanent', placeholder: false },
        { name: 'priority', label: 'Priority', type: 'select', options: PRIORITY, value: 'Low', placeholder: false },
        { name: 'reason', label: 'Business justification', type: 'textarea', required: true, full: true },
      ],
      onSubmit: (d, close) => submit({
        type: 'Software Request', category: 'Software', priority: d.priority,
        subject: `Software request: ${d.software}`, description: `Software: ${d.software}\nDuration: ${d.duration}\n\n${d.reason}`,
      }, close),
    });
  }
  if (kind === 'transfer') {
    const ents = ctx.lookups.entities.filter((e) => e.is_active);
    return formModal({
      title: 'Asset Transfer Request', submitText: 'Submit for approval',
      fields: [
        { name: 'asset_id', label: 'Asset to transfer', type: 'select', required: true, full: true, options: assetOpts, value: preset.asset_id,
          help: mine.length ? '' : 'You have no assigned equipment — describe the asset below instead.' },
        { name: 'to_person', label: 'Transfer to (employee)', placeholder: 'Name or email' },
        { name: 'to_entity', label: 'Transfer to (entity)', type: 'select', options: opts(ents, 'name', 'name') },
        { name: 'reason', label: 'Reason', type: 'textarea', required: true, full: true },
      ],
      onMount: (form) => { if (!mine.length) form.querySelector('[name=asset_id]').removeAttribute('required'); },
      onSubmit: (d, close) => {
        const a = mine.find((x) => String(x.id) === d.asset_id);
        return submit({
          type: 'Asset Transfer', category: 'Hardware', priority: 'Medium', asset_id: d.asset_id || null,
          subject: `Asset transfer: ${a ? a.asset_tag : 'asset'}${d.to_person ? ` → ${d.to_person}` : ''}`,
          description: `Asset: ${a ? `${a.asset_tag} — ${a.name}` : 'see details'}\nTo employee: ${d.to_person || 'n/a'}\nTo entity: ${d.to_entity || 'n/a'}\n\n${d.reason}`,
        }, close);
      },
    });
  }
  if (kind === 'onboarding') {
    const ents = ctx.lookups.entities.filter((e) => e.is_active);
    return formModal({
      title: 'Onboarding Request', submitText: 'Submit for approval', size: 'lg',
      fields: [
        { name: 'name', label: 'New employee name', required: true },
        { name: 'start', label: 'Start date', type: 'date', required: true },
        { name: 'entity', label: 'Entity', type: 'select', required: true, options: opts(ents, 'name', 'name') },
        { name: 'department', label: 'Department' },
        { name: 'title', label: 'Job title' },
        { name: 'manager', label: 'Reporting manager' },
        { name: 'eq_laptop', label: 'Laptop', type: 'checkbox', value: true },
        { name: 'eq_monitor', label: 'Monitor', type: 'checkbox' },
        { name: 'eq_mobile', label: 'Mobile phone', type: 'checkbox' },
        { name: 'eq_email', label: 'Email & Microsoft 365', type: 'checkbox', value: true },
        { name: 'eq_erp', label: 'ERP access', type: 'checkbox' },
        { name: 'eq_vpn', label: 'VPN / remote access', type: 'checkbox' },
        { name: 'notes', label: 'Other software / access needed', type: 'textarea', full: true, rows: 3 },
      ],
      onSubmit: (d, close) => {
        const items = [['eq_laptop', 'Laptop'], ['eq_monitor', 'Monitor'], ['eq_mobile', 'Mobile phone'], ['eq_email', 'Email & M365'], ['eq_erp', 'ERP access'], ['eq_vpn', 'VPN']]
          .filter(([k]) => d[k]).map(([, l]) => `• ${l}`).join('\n');
        const ent = ents.find((e) => e.name === d.entity);
        return submit({
          type: 'Onboarding', category: 'Accounts', priority: 'Medium', entity_id: ent?.id,
          subject: `New employee setup: ${d.name}`,
          description: `Name: ${d.name}\nStart date: ${d.start}\nEntity: ${d.entity}\nDepartment: ${d.department || 'n/a'}\nJob title: ${d.title || 'n/a'}\nManager: ${d.manager || 'n/a'}\n\nRequired:\n${items || '—'}\n\n${d.notes || ''}`,
        }, close);
      },
    });
  }
}

export async function render(ctx) {
  const { el } = ctx;
  el.innerHTML = '<div class="loading"><span class="spin"></span></div>';
  const d = await api.get('/me/overview');
  if (!ctx.alive()) return;
  const open = d.tickets.filter((t) => !['Resolved', 'Closed', 'Rejected'].includes(t.status));

  el.innerHTML = str(html`
  <div class="page-head"><div><h2>Hello, ${ctx.user.full_name.split(' ')[0]}</h2><p class="muted">Your equipment, software and IT requests in one place.</p></div>
    <button class="btn btn-primary" data-qa="incident">${icon('plus', 18)} Raise a Ticket</button></div>

  <div class="qa-row">
    ${[['incident', 'ticket', 'blue', 'Raise a Ticket'], ['asset', 'laptop', 'green', 'Request Asset'], ['software', 'grid', 'purple', 'Request Software'],
      ['issue', 'alert', 'red', 'Report an Issue'], ['transfer', 'swap', 'amber', 'Asset Transfer'], ['onboarding', 'userPlus', 'sky', 'Onboarding Request']]
      .map(([k, ic, tone, l]) => html`<button class="qa tone-${tone}" data-qa="${k}">${icon(ic, 24)}<span>${l}</span></button>`)}
  </div>

  <div class="grid-2">
    <div class="card">
      <div class="card-head"><h3>My Equipment <span class="count">${d.assets.length}</span></h3></div>
      ${d.assets.length ? html`<div class="equip">${d.assets.map((a) => html`
        <div class="equip-card">
          <span class="thumb lg">${icon(categoryIcon(a.category), 28)}</span>
          <div class="grow"><b>${a.name}</b><span class="muted">${a.category} · <span class="mono">${a.asset_tag}</span></span>
            <span class="muted small">Serial ${a.serial_number || '—'} · Warranty ${fmtDate(a.warranty_expiry)}</span></div>
          <button class="btn btn-sm" data-report="${a.id}">${icon('alert', 15)} Report issue</button>
        </div>`)}</div>` : empty('No equipment is assigned to you yet.', 'laptop')}
    </div>
    <div class="card">
      <div class="card-head"><h3>My Software <span class="count">${d.licenses.length}</span></h3></div>
      ${d.licenses.length ? html`<ul class="mini-list">${d.licenses.map((l) => html`<li><div class="row-flat"><span class="thumb">${icon('key', 18)}</span><div><b>${l.name}</b><span>${l.vendor || ''} · since ${fmtDate(l.assigned_at)}</span></div></div></li>`)}</ul>`
        : empty('No software licenses assigned.', 'key')}
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h3>My Requests <span class="count">${open.length} open</span></h3></div>
    ${d.tickets.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>Subject</th><th>Type</th><th>Priority</th><th>Status</th><th>Assigned to</th><th>Updated</th></tr></thead>
      <tbody>${d.tickets.map((t) => html`<tr data-href="#/tickets/${t.id}"><td class="mono">${t.ticket_no}</td><td>${t.subject}</td><td class="muted">${t.type}</td>
        <td>${badge(t.priority)}</td><td>${badge(t.status)}</td><td>${t.assignee_name || html`<span class="muted">—</span>`}</td><td class="nowrap muted">${ago(t.updated_at)}</td></tr>`)}</tbody></table></div>`
      : empty("You haven't raised any requests yet.", 'ticket')}
  </div>`);

  el.querySelectorAll('[data-qa]').forEach((b) => b.addEventListener('click', () => quickAction(b.dataset.qa, ctx, () => ctx.reload())));
  el.querySelectorAll('[data-report]').forEach((b) => b.addEventListener('click', () => quickAction('issue', ctx, () => ctx.reload(), { asset_id: b.dataset.report })));
  el.querySelectorAll('tr[data-href]').forEach((r) => r.addEventListener('click', () => { location.hash = r.dataset.href; }));
}
