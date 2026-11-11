import { api, auth } from '../api.js';
import { html, str, icon, badge, fmtDate, fmtDateTime, fmtMoney, ago, categoryIcon, empty, pager, formModal, confirmBox, toast, toastErr, opts, debounce, spinner, modal, fmtNum } from '../ui.js';

const assetFields = (ctx, a = {}) => [
  { name: 'asset_tag', label: 'Asset tag', required: true, value: a.asset_tag },
  { name: 'category', label: 'Category', type: 'select', required: true, options: ctx.lookups.categories, value: a.category },
  { name: 'name', label: 'Name', required: true, full: true, value: a.name, placeholder: 'e.g. Dell Latitude 5440' },
  { name: 'brand', label: 'Brand', value: a.brand },
  { name: 'model', label: 'Model', value: a.model },
  { name: 'serial_number', label: 'Serial number', value: a.serial_number },
  { name: 'status', label: 'Status', type: 'select', placeholder: false, value: a.status || 'In Stock',
    options: ctx.lookups.assetStatuses.filter((s) => s !== 'Assigned' || a.status === 'Assigned') },
  { name: 'condition', label: 'Condition', type: 'select', placeholder: false, options: ['New', 'Good', 'Fair', 'Poor', 'Damaged'], value: a.condition || 'Good' },
  { name: 'entity_id', label: 'Entity', type: 'select', options: opts(ctx.lookups.entities), value: a.entity_id },
  { name: 'location', label: 'Location', value: a.location, placeholder: 'e.g. Head Office - Dubai' },
  { name: 'supplier', label: 'Supplier', value: a.supplier },
  { name: 'purchase_date', label: 'Purchase date', type: 'date', value: a.purchase_date },
  { name: 'purchase_cost', label: 'Purchase cost (AED)', type: 'number', step: '0.01', value: a.purchase_cost },
  { name: 'warranty_expiry', label: 'Warranty expiry', type: 'date', value: a.warranty_expiry },
  { name: 'purchase_ref', label: 'Purchase ref (PR No.)', value: a.purchase_ref },
  { type: 'heading', label: 'Specifications' },
  { name: 'os', label: 'Operating system', value: a.os },
  { name: 'processor', label: 'Processor', value: a.processor },
  { name: 'ram', label: 'RAM', value: a.ram },
  { name: 'storage', label: 'Storage', value: a.storage },
  { name: 'graphics', label: 'Graphics', value: a.graphics },
  { name: 'remote_id', label: 'AnyDesk ID', value: a.remote_id },
  { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 3, value: a.notes },
];

export function assetForm(ctx, a, done) {
  const editing = !!a?.id;
  return formModal({
    title: editing ? `Edit ${a.asset_tag}` : 'Add Asset', size: 'lg', submitText: editing ? 'Save changes' : 'Add asset',
    fields: assetFields(ctx, a || {}),
    onMount: (form) => {
      if (editing) return;
      const cat = form.querySelector('[name=category]');
      const tag = form.querySelector('[name=asset_tag]');
      const suggest = async () => { if (!tag.dataset.touched && cat.value) tag.value = (await api.get(`/assets/next-tag?category=${encodeURIComponent(cat.value)}`)).tag; };
      tag.addEventListener('input', () => { tag.dataset.touched = 1; });
      cat.addEventListener('change', suggest);
    },
    onSubmit: async (d, close) => {
      const r = editing ? await api.put(`/assets/${a.id}`, d) : await api.post('/assets', d);
      toast(editing ? 'Asset updated' : `Asset ${r.asset_tag} added`); close(); done?.(r);
    },
  });
}

const userOpts = (ctx) => ctx.lookups.users.map((u) => ({ value: u.id, label: `${u.full_name}${u.department ? ` — ${u.department}` : ''}` }));

export function assignForm(ctx, a, done) {
  return formModal({
    title: `${a.assigned_to ? 'Reassign' : 'Assign'} ${a.asset_tag}`, size: 'sm', submitText: 'Assign',
    fields: [
      { name: 'user_id', label: 'Employee', type: 'select', required: true, full: true, options: userOpts(ctx), value: a.assigned_to },
      { name: 'note', label: 'Note', full: true, placeholder: 'Optional handover note' },
    ],
    onSubmit: async (d, close) => { await api.post(`/assets/${a.id}/assign`, d); toast('Asset assigned'); close(); done?.(); },
  });
}

export function transferForm(ctx, a, done) {
  return formModal({
    title: `Transfer ${a.asset_tag}`, submitText: 'Transfer',
    intro: html`<p class="muted small full">Currently: <b>${a.entity_name || 'No entity'}</b> · ${a.location || 'No location'} · ${a.assigned_name || 'Unassigned'}</p>`,
    fields: [
      { name: 'entity_id', label: 'To entity', type: 'select', options: opts(ctx.lookups.entities.filter((e) => e.is_active)), placeholder: 'Keep current' },
      { name: 'location', label: 'To location', placeholder: 'Keep current' },
      { name: 'user_id', label: 'New holder', type: 'select', full: true, options: userOpts(ctx), placeholder: 'Keep current holder' },
      { name: 'note', label: 'Reason / note', type: 'textarea', rows: 2, full: true },
    ],
    onSubmit: async (d, close) => { await api.post(`/assets/${a.id}/transfer`, d); toast('Asset transferred'); close(); done?.(); },
  });
}

// ---------- IT sheet import ----------
function importModal(done) {
  let file = null;
  const send = async (commit) => {
    const res = await fetch(`/api/assets/import${commit ? '?commit=1' : ''}`, {
      method: 'POST', headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/octet-stream' }, body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Import failed');
    return data;
  };
  const list = (title, items, note) => (items.length ? html`<p class="small"><b>${title}</b> (${items.length})${note ? html` <span class="muted">— ${note}</span>` : ''}</p><ul class="issue-list">${items.map((x) => html`<li>${x}</li>`)}</ul>` : '');
  modal({
    title: 'Import assets from IT sheet', size: 'lg',
    body: html`<div data-step>
      <p class="muted small" style="margin-bottom:12px">Upload the <b>ALPAGO ASSET IT DETAILS</b> workbook (.xlsx). Handover rows are combined into one asset per serial number with its history, and each current holder is matched to an employee. Import employees first so holders can be matched. Re-importing updates existing assets and keeps assignments you fixed by hand.</p>
      <label class="dropzone" data-drop>${icon('download', 28)}<b data-fname>Choose or drop the .xlsx file</b><span class="small">Nothing is saved until you confirm</span>
        <input type="file" accept=".xlsx" hidden></label>
      <div class="note" style="margin-top:12px">${icon('lock', 16)}<span>Admin accounts and passwords, Apple ID logins and notes that look like credentials are skipped and never stored. The Etisalat sheet is ignored.</span></div>
      <div class="form-error" hidden style="margin-top:12px"></div></div>`,
    footer: html`<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-go disabled>Preview import</button>`,
    onMount: (m, close) => {
      const input = m.querySelector('input[type=file]'); const drop = m.querySelector('[data-drop]'); const go = m.querySelector('[data-go]');
      const step = m.querySelector('[data-step]'); let preview = null;
      const pick = (f) => { if (!f) return; file = f; m.querySelector('[data-fname]').textContent = f.name; go.disabled = false; };
      input.addEventListener('change', () => pick(input.files[0]));
      ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', (e) => pick(e.dataTransfer.files[0]));
      go.addEventListener('click', async () => {
        go.disabled = true;
        try {
          if (!preview) {
            go.textContent = 'Reading file…';
            preview = await send(false);
            const p = preview;
            step.innerHTML = str(html`
              <div class="stat-row">
                <div class="stat"><b>${fmtNum(p.assets)}</b><span>assets (from ${fmtNum(p.rows)} rows)</span></div>
                <div class="stat"><b>${fmtNum(p.assigned)}</b><span>assigned to employees</span></div>
                <div class="stat"><b>${fmtNum(p.inUse)}</b><span>in use, holder not matched</span></div>
                <div class="stat"><b>${fmtNum(p.inStock)}</b><span>in stock / returned</span></div>
              </div>
              <p class="small" style="margin-bottom:6px"><b>New:</b> ${p.created} · <b>Updated:</b> ${p.updated} · <b>By type:</b> ${Object.entries(p.byCategory).map(([k, v]) => `${k} ${v}`).join(', ')} · <b>No serial:</b> ${p.noSerial}</p>
              ${p.employeesInPortal < 10 ? html`<div class="form-error">Only ${p.employeesInPortal} employees are in the portal — import employees from HR first, otherwise holders can't be matched.</div>` : ''}
              ${list('Matched on one name only', p.weak, 'assigned, flagged for you to confirm')}
              ${list('Holder matches several employees', p.ambiguous, 'left unassigned for review')}
              ${list('Holder not found in employees', p.unmatched, 'left unassigned for review')}
              ${list('Listed as in use by more than one person', p.doubleAssigned, 'last holder used; flagged')}
              <div class="form-error" hidden style="margin-top:12px"></div>`);
            go.textContent = `Import ${fmtNum(p.assets)} assets`; go.disabled = false;
          } else {
            go.textContent = 'Importing…';
            const r = await send(true);
            toast(`Imported: ${r.created} added, ${r.updated} updated, ${r.assigned} assigned`);
            close(); done?.();
          }
        } catch (e) {
          const box = m.querySelector('.form-error'); box.hidden = false; box.textContent = e.message;
          go.disabled = false; go.textContent = preview ? `Import ${fmtNum(preview.assets)} assets` : 'Preview import';
        }
      });
    },
  });
}

// ---------- list ----------
async function list(ctx) {
  const { el, can, lookups } = ctx;
  const q = { pageSize: 25, page: 1, sort: 'asset_tag', dir: 'asc', ...ctx.query };
  el.innerHTML = str(html`
  <div class="page-head"><div><h2>Asset Inventory</h2><p class="muted">Hardware across all Alpago Group entities.</p></div>
    <div class="actions"><button class="btn" data-export>${icon('download', 17)} Export CSV</button>
    ${can('assets.manage') ? html`<button class="btn" data-import>${icon('file', 17)} Import from IT sheet</button>
      <button class="btn btn-primary" data-add>${icon('plus', 18)} Add Asset</button>` : ''}</div></div>
  <div class="card">
    <div class="filters">
      <div class="search">${icon('search', 17)}<input name="q" placeholder="Search tag, name, serial, holder…" value="${q.q || ''}"></div>
      <select name="category"><option value="">All categories</option>${lookups.categories.map((c) => html`<option ${c === q.category ? 'selected' : ''}>${c}</option>`)}</select>
      <select name="status"><option value="">All statuses</option>${lookups.assetStatuses.map((c) => html`<option ${c === q.status ? 'selected' : ''}>${c}</option>`)}</select>
      <select name="entity_id"><option value="">All entities</option>${lookups.entities.map((e) => html`<option value="${e.id}" ${String(e.id) === q.entity_id ? 'selected' : ''}>${e.name}</option>`)}</select>
      <select name="warranty"><option value="">Any warranty</option><option value="expiring" ${q.warranty === 'expiring' ? 'selected' : ''}>Expiring ≤ 90 days</option><option value="expired" ${q.warranty === 'expired' ? 'selected' : ''}>Expired</option></select>
      <select name="review"><option value="">All records</option><option value="1" ${q.review === '1' ? 'selected' : ''}>Needs review</option></select>
    </div>
    <div data-results>${spinner()}</div>
  </div>`);

  const results = el.querySelector('[data-results]');
  const load = async () => {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== '' && v !== undefined)).toString();
    history.replaceState(null, '', `#/assets?${new URLSearchParams(Object.entries(q).filter(([k, v]) => v && !['pageSize', 'sort', 'dir'].includes(k) && !(k === 'page' && v == 1))).toString()}`);
    const d = await api.get(`/assets?${qs}`);
    if (!ctx.alive()) return;
    const th = (key, label) => html`<th class="sortable ${q.sort === key ? `sorted ${q.dir}` : ''}" data-sort="${key}">${label}</th>`;
    results.innerHTML = str(d.rows.length ? html`<div class="table-wrap"><table class="table">
      <thead><tr>${th('asset_tag', 'Asset tag')}${th('name', 'Asset')}${th('category', 'Category')}${th('status', 'Status')}${th('assigned', 'Assigned to')}${th('entity', 'Entity')}${th('warranty', 'Warranty')}<th></th></tr></thead>
      <tbody>${d.rows.map((a) => html`<tr data-href="#/assets/${a.id}">
        <td class="mono">${a.asset_tag}</td>
        <td><div class="cell-asset"><span class="thumb sm">${icon(categoryIcon(a.category), 17)}</span><div><b>${a.name}</b><span class="muted small">${a.serial_number || ''}</span></div></div></td>
        <td>${a.category}</td><td>${badge(a.status)} ${a.review_flag ? html`<span title="${a.review_flag}">${badge('Review', 'amber')}</span>` : ''}</td>
        <td>${a.assigned_name || (a.sheet_holder ? html`<span class="muted" title="Name in IT sheet — not matched">${a.sheet_holder} ${icon('alert', 13)}</span>` : html`<span class="muted">—</span>`)}</td>
        <td class="muted">${a.entity_name || '—'}</td>
        <td class="nowrap ${a.warranty_expiry && new Date(a.warranty_expiry) < new Date() ? 'txt-red' : ''}">${fmtDate(a.warranty_expiry)}</td>
        <td class="row-actions">${can('assets.assign') && a.status !== 'Retired' ? html`<button class="icon-btn" title="Assign" data-assign="${a.id}">${icon('userPlus', 17)}</button>` : ''}</td>
      </tr>`)}</tbody></table></div>${pager(d.total, d.page, d.pageSize)}`
      : empty('No assets match these filters', 'monitor'));
    results.querySelectorAll('tr[data-href]').forEach((r) => r.addEventListener('click', (e) => { if (!e.target.closest('button')) location.hash = r.dataset.href; }));
    results.querySelectorAll('[data-sort]').forEach((t) => t.addEventListener('click', () => {
      q.dir = q.sort === t.dataset.sort && q.dir === 'asc' ? 'desc' : 'asc'; q.sort = t.dataset.sort; q.page = 1; load();
    }));
    results.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { q.page = +b.dataset.page; load(); }));
    results.querySelectorAll('[data-assign]').forEach((b) => b.addEventListener('click', () => assignForm(ctx, d.rows.find((a) => a.id === +b.dataset.assign), load)));
  };
  const reload = () => { q.page = 1; load().catch(toastErr); };
  el.querySelector('[name=q]').addEventListener('input', debounce((e) => { q.q = e.target.value; reload(); }, 300));
  el.querySelectorAll('.filters select').forEach((s) => s.addEventListener('change', () => { q[s.name] = s.value; reload(); }));
  el.querySelector('[data-import]')?.addEventListener('click', () => importModal(() => { q.page = 1; ctx.reload(); }));
  el.querySelector('[data-add]')?.addEventListener('click', () => assetForm(ctx, null, async (r) => { await ctx.refreshLookups(); location.hash = `#/assets/${r.id}`; }));
  el.querySelector('[data-export]').addEventListener('click', () => {
    const qs = new URLSearchParams(Object.entries(q).filter(([k, v]) => v && !['page', 'pageSize'].includes(k))).toString();
    api.download(`/assets/export.csv?${qs}`, 'alpago-assets.csv').catch(toastErr);
  });
  await load();
}

// ---------- detail ----------
async function detail(ctx, id) {
  const { el, can } = ctx;
  el.innerHTML = str(spinner());
  const a = await api.get(`/assets/${id}`);
  if (!ctx.alive()) return;
  ctx.setTitle(a.asset_tag);
  const refresh = () => detail(ctx, id).catch(toastErr);
  const row = (k, v) => html`<div class="kv"><span>${k}</span><b>${v ?? '—'}</b></div>`;
  const retired = a.status === 'Retired';

  el.innerHTML = str(html`
  <a class="back" href="#/assets">${icon('chevLeft', 16)} Assets</a>
  <div class="page-head">
    <div class="title-row"><span class="thumb lg">${icon(categoryIcon(a.category), 30)}</span>
      <div><h2>${a.name}</h2><p class="muted"><span class="mono">${a.asset_tag}</span> · ${a.category} ${badge(a.status)}</p></div></div>
    <div class="actions">
      ${can('assets.assign') && !retired ? html`
        <button class="btn" data-assign>${icon('userPlus', 17)} ${a.assigned_to ? 'Reassign' : 'Assign'}</button>
        ${a.assigned_to ? html`<button class="btn" data-return>${icon('inbox', 17)} Return to stock</button>` : ''}
        <button class="btn" data-transfer>${icon('swap', 17)} Transfer</button>` : ''}
      ${can('assets.manage') ? html`<button class="btn" data-edit>${icon('edit', 17)} Edit</button>
        ${!retired ? html`<button class="btn btn-ghost-danger" data-retire>Retire</button>` : html`<button class="btn btn-ghost-danger" data-delete>${icon('trash', 16)} Delete</button>`}` : ''}
      ${!can('assets.manage') && a.assigned_to === ctx.user.id ? html`<a class="btn" href="#/my">${icon('alert', 16)} Report issue</a>` : ''}
    </div>
  </div>

  ${a.review_flag ? html`<div class="note review-note">${icon('alert', 16)}<span><b>Needs review:</b> ${a.review_flag}${a.sheet_holder ? html` · Name in IT sheet: <b>${a.sheet_holder}</b>` : ''}</span>
    <span class="grow"></span>${can('assets.assign') ? html`${a.assigned_to ? html`<button class="btn btn-sm btn-success" data-confirm>${icon('check', 14)} Confirm ${a.assigned_name}</button>` : ''}
      <button class="btn btn-sm" data-assign2>${icon('userPlus', 14)} ${a.assigned_to ? 'Change holder' : 'Assign holder'}</button>
      ${!a.assigned_to ? html`<button class="btn btn-sm" data-confirm>Mark reviewed</button>` : ''}` : ''}</div>` : ''}
  <div class="grid-2 detail">
    <div class="card">
      <div class="card-head"><h3>Details</h3></div>
      <div class="kv-grid">
        ${row('Assigned to', a.assigned_name ? html`<a href="#/employees/${a.assigned_to}">${a.assigned_name}</a>` : 'Unassigned')}
        ${row('Assigned since', a.assigned_at ? fmtDate(a.assigned_at) : '—')}
        ${row('Entity', a.entity_name)}${row('Location', a.location)}
        ${row('Brand', a.brand)}${row('Model', a.model)}
        ${row('Serial number', a.serial_number)}${row('Condition', a.condition)}
        ${row('Purchase date', fmtDate(a.purchase_date))}${row('Purchase cost', fmtMoney(a.purchase_cost))}
        ${row('Supplier', a.supplier)}${row('Warranty expiry', fmtDate(a.warranty_expiry))}
        ${row('Purchase ref', a.purchase_ref)}${row('AnyDesk ID', a.remote_id)}
      </div>
      ${a.os || a.processor || a.ram || a.storage || a.graphics ? html`<h6 class="section-title">Specifications</h6><div class="kv-grid">
        ${row('Operating system', a.os)}${row('Processor', a.processor)}${row('RAM', a.ram)}${row('Storage', a.storage)}${a.graphics ? row('Graphics', a.graphics) : ''}</div>` : ''}
      ${a.notes ? html`<div class="notes"><h6>Notes</h6><p>${a.notes}</p></div>` : ''}
    </div>
    <div class="card">
      <div class="card-head"><h3>History</h3></div>
      <ul class="timeline">${a.history.map((h) => html`<li>
        <i class="tl-dot"></i><div><b>${h.action}</b>
        ${h.to_user_name && h.action !== 'Created' && !(h.action === 'Transferred' && h.to_user === h.from_user) ? html` → ${h.to_user_name}` : ''}${h.action === 'Returned' && h.from_user_name ? html` from ${h.from_user_name}` : ''}
        ${h.action === 'Transferred' && h.from_entity !== h.to_entity ? html` · ${h.from_entity_name || '—'} → ${h.to_entity_name || '—'}` : ''}
        ${h.note ? html`<p class="muted small">${h.note}</p>` : ''}
        <span class="muted small">${fmtDateTime(h.created_at)}${h.performed_by_name ? ` · by ${h.performed_by_name}` : ''}</span></div></li>`)}</ul>
    </div>
  </div>
  ${a.tickets.length ? html`<div class="card"><div class="card-head"><h3>Related Tickets</h3></div>
    <div class="table-wrap"><table class="table"><tbody>${a.tickets.map((t) => html`<tr data-href="#/tickets/${t.id}"><td class="mono">${t.ticket_no}</td><td>${t.subject}</td><td>${badge(t.priority)}</td><td>${badge(t.status)}</td><td class="muted">${ago(t.created_at)}</td></tr>`)}</tbody></table></div></div>` : ''}`);

  el.querySelectorAll('tr[data-href]').forEach((r) => r.addEventListener('click', () => { location.hash = r.dataset.href; }));
  el.querySelector('[data-assign]')?.addEventListener('click', () => assignForm(ctx, a, refresh));
  el.querySelector('[data-assign2]')?.addEventListener('click', () => assignForm(ctx, a, refresh));
  el.querySelector('[data-confirm]')?.addEventListener('click', () => api.post(`/assets/${a.id}/confirm`, {}).then(() => { toast('Marked as reviewed'); refresh(); }).catch(toastErr));
  el.querySelector('[data-transfer]')?.addEventListener('click', () => transferForm(ctx, a, refresh));
  el.querySelector('[data-edit]')?.addEventListener('click', () => assetForm(ctx, a, refresh));
  el.querySelector('[data-return]')?.addEventListener('click', async () => {
    if (!(await confirmBox('Return to stock', `Unassign ${a.asset_tag} from ${a.assigned_name}?`))) return;
    await api.post(`/assets/${a.id}/unassign`, {}).then(() => { toast('Asset returned to stock'); refresh(); }).catch(toastErr);
  });
  el.querySelector('[data-retire]')?.addEventListener('click', async () => {
    if (!(await confirmBox('Retire asset', `Retire ${a.asset_tag}? It will be unassigned and excluded from active counts.`, { danger: true, okText: 'Retire' }))) return;
    await api.put(`/assets/${a.id}`, { status: 'Retired' }).then(() => { toast('Asset retired'); refresh(); }).catch(toastErr);
  });
  el.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (!(await confirmBox('Delete asset', `Permanently delete ${a.asset_tag} and its history? This cannot be undone.`, { danger: true, okText: 'Delete' }))) return;
    await api.del(`/assets/${a.id}`).then(() => { toast('Asset deleted'); location.hash = '#/assets'; }).catch(toastErr);
  });
}

export async function render(ctx) {
  if (ctx.params[0]) return detail(ctx, ctx.params[0]);
  if (!ctx.can('assets.view')) { location.hash = '#/my'; return; }
  return list(ctx);
}
