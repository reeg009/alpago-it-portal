import { api, auth } from '../api.js';
import { html, str, icon, badge, avatar, empty, spinner, pager, formModal, modal, confirmBox, toast, toastErr, debounce, fmtNum, fmtDate } from '../ui.js';

const COLS = [
  ['sl_no', 'Sl No'], ['entity', 'Entity'], ['account', 'Account'], ['account_name', 'Account Name'],
  ['product_category', 'Product Category'], ['product_type', 'Product Type'], ['activation_date', 'Activation Date'],
  ['status', 'Status'], ['party_id', 'Party ID'], ['limit_amount', 'Limit'], ['package', 'Package'],
  ['holder_name', 'Name'], ['designation', 'Designation'], ['remarks', 'Remarks'], ['comments', 'Comments'],
];
const ENTITIES = ['ALPAGO GROUP', 'ALPAGO DESIGN AND BUILD', 'ALPAGO PROPERTIES', 'ALPAGO FACILITY MGT', 'ALPAGO MANUFACTURING'];

function lineForm(ctx, l, done) {
  const editing = !!l?.id;
  const people = ctx.lookups.users.map((u) => ({ value: u.id, label: u.full_name }));
  return formModal({
    title: editing ? `Edit ${l.account || 'line'}` : 'Add ISP line', size: 'lg', submitText: editing ? 'Save' : 'Add line',
    fields: [
      { type: 'heading', label: 'Line' },
      { name: 'list', label: 'List', type: 'select', options: ['Active', 'Cancelled'], value: l?.list || ctx.query.list || 'Active', placeholder: false },
      { name: 'provider', label: 'Provider', type: 'select', options: ['Etisalat', 'du', 'Other'], value: l?.provider || 'Etisalat', placeholder: false },
      ...COLS.filter(([k]) => !['remarks', 'comments'].includes(k)).map(([k, label]) => ({
        name: k, label, value: l?.[k], type: k === 'activation_date' ? 'date' : 'text',
        ...(k === 'entity' ? { type: 'select', options: [...new Set([...ENTITIES, ...(l?.entity ? [l.entity] : [])])] } : {}),
      })),
      { name: 'employee_id', label: 'Linked employee (optional)', type: 'select', options: people, value: l?.employee_id, placeholder: 'Not linked' },
      { name: 'remarks', label: 'Remarks', type: 'textarea', rows: 2, full: true, value: l?.remarks, help: 'Do not enter Emirates ID or passport details — they are removed automatically.' },
      { name: 'comments', label: 'Comments', type: 'textarea', rows: 2, full: true, value: l?.comments },
    ],
    onSubmit: async (d, close) => {
      if (editing) await api.put(`/isp/lines/${l.id}`, d); else await api.post('/isp/lines', d);
      toast(editing ? 'Line updated' : 'Line added'); close(); done?.();
    },
  });
}

function contactForm(c, done) {
  return formModal({
    title: c ? `Edit ${c.name}` : 'Add B2B contact', size: 'md', submitText: 'Save',
    fields: [
      { name: 'sl_no', label: 'Sl No', value: c?.sl_no }, { name: 'name', label: 'Name', required: true, value: c?.name },
      { name: 'email', label: 'Email', type: 'email', value: c?.email }, { name: 'phone', label: 'Phone', value: c?.phone },
      { name: 'entities', label: 'Entities (comma-separated)', full: true, value: c?.entities },
      { name: 'provider', label: 'Provider', type: 'select', options: ['Etisalat', 'du', 'Other'], value: c?.provider || 'Etisalat', placeholder: false },
    ],
    onSubmit: async (d, close) => { if (c) await api.put(`/isp/contacts/${c.id}`, d); else await api.post('/isp/contacts', d); toast('Contact saved'); close(); done?.(); },
  });
}

function importModal(done) {
  let file = null;
  const send = async (commit) => {
    const res = await fetch(`/api/isp/import${commit ? '?commit=1' : ''}`, { method: 'POST', headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/octet-stream' }, body: file });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Import failed');
    return data;
  };
  modal({
    title: 'Import ISP sheet', size: 'md',
    body: html`<div data-step><p class="muted small" style="margin-bottom:12px">Upload the workbook with the <b>Etisalat</b> sheet. The Active list, the CANCELLED list and the B2B contacts are loaded exactly as in the sheet, in the same order.</p>
      <label class="dropzone" data-drop>${icon('download', 28)}<b data-fname>Choose or drop the .xlsx file</b><span class="small">Nothing is saved until you confirm</span><input type="file" accept=".xlsx" hidden></label>
      <div class="note" style="margin-top:12px">${icon('alert', 16)}<span>Importing <b>replaces</b> the current lines and contacts for that provider with the sheet. Emirates ID numbers and dates of birth in remarks are removed.</span></div>
      <div class="form-error" hidden style="margin-top:12px"></div></div>`,
    footer: html`<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-go disabled>Preview import</button>`,
    onMount: (m, close) => {
      const input = m.querySelector('input[type=file]'); const drop = m.querySelector('[data-drop]'); const go = m.querySelector('[data-go]');
      let preview = null;
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
            const p = preview = await send(false);
            m.querySelector('[data-step]').innerHTML = str(html`
              <div class="stat-row"><div class="stat"><b>${p.active}</b><span>active lines</span></div><div class="stat"><b>${p.cancelled}</b><span>cancelled</span></div>
                <div class="stat"><b>${p.contacts}</b><span>B2B contacts</span></div><div class="stat"><b>${p.linkedToEmployees}</b><span>linked to employees</span></div></div>
              <p class="small">Sheet: <b>${p.sheet}</b> · Provider: <b>${p.provider}</b>${p.masked ? ` · ${p.masked} remark(s) with ID details masked` : ''}</p>
              ${p.replaces ? html`<div class="form-error" style="margin-top:10px">This replaces the ${p.replaces} ${p.provider} lines currently in the portal (including manual edits).</div>` : ''}
              <div class="form-error" hidden style="margin-top:10px"></div>`);
            go.textContent = `Import ${p.active + p.cancelled} lines`; go.disabled = false;
          } else {
            go.textContent = 'Importing…';
            const r = await send(true);
            toast(`Imported ${r.active} active and ${r.cancelled} cancelled lines`); close(); done?.();
          }
        } catch (e) {
          const box = m.querySelector('.form-error[hidden]') || m.querySelector('.form-error'); box.hidden = false; box.textContent = e.message;
          go.disabled = false; go.textContent = preview ? 'Import' : 'Preview import';
        }
      });
    },
  });
}

// ---------- helpers ----------
function lineType(l) {
  const t = `${l.product_category || ''} ${l.product_type || ''} ${l.designation || ''} ${l.holder_name || ''} ${l.package || ''}`.toUpperCase();
  const acc = String(l.account || '').replace(/\D/g, '');
  if (/INTERNET|WIRELESS|ROUTER|BUSINESS IN A BOX|BFXI|WIFI/.test(t)) return 'Internet';
  if (/LANDLINE|PBX|TOLL FREE|CARE NUMBER/.test(t) || /^(04|800|900)/.test(acc)) return 'Landline';
  if (/MOBILE|GS\b|ISHARE|PREPAID/.test(t) || /^05\d{8}$/.test(acc)) return 'Mobile';
  return 'Other';
}
const TYPE_ICON = { Mobile: 'phone', Internet: 'network', Landline: 'desktop', Other: 'box' };
const TYPE_TONE = { Mobile: 'blue', Internet: 'teal', Landline: 'purple', Other: 'slate' };
const fmtAcc = (a) => {
  const d = String(a || '');
  return /^05\d{8}$/.test(d) ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : d;
};
const isNum = (v) => v !== null && v !== undefined && /^\s*\d+(\.\d+)?\s*$/.test(String(v));

// ---------- detail ----------
async function detail(ctx, id) {
  const { el, can } = ctx;
  el.innerHTML = str(spinner());
  const l = await api.get(`/isp/line/${id}`);
  if (!ctx.alive()) return;
  const type = lineType(l);
  ctx.setTitle(fmtAcc(l.account) || 'ISP line');
  const manage = can('isp.manage');
  const kv = (k, v) => html`<div class="kv"><span>${k}</span><b>${v === null || v === undefined || v === '' ? '—' : v}</b></div>`;
  const back = l.list === 'Cancelled' ? '#/isp?list=Cancelled' : '#/isp';
  el.innerHTML = str(html`
  <a class="back" href="${back}">${icon('chevLeft', 16)} ISP &amp; Telecom</a>
  <div class="page-head"><div class="title-row"><span class="thumb lg tone-${TYPE_TONE[type]}">${icon(TYPE_ICON[type], 28)}</span>
    <div><h2 class="mono-lg">${fmtAcc(l.account) || 'No account number'}</h2>
      <p class="muted">${type} · ${l.provider}${l.product_category ? ` · ${l.product_category}` : ''}
        ${badge(l.list === 'Cancelled' ? 'Cancelled' : (l.status || 'Active'), l.list === 'Cancelled' ? 'gray' : 'green')}</p></div></div>
    ${manage ? html`<div class="actions"><button class="btn btn-ghost-danger" data-del>${icon('trash', 16)} Delete</button>
      <button class="btn" data-move>${icon(l.list === 'Active' ? 'x' : 'history', 16)} ${l.list === 'Active' ? 'Move to Cancelled' : 'Reactivate'}</button>
      <button class="btn btn-primary" data-edit>${icon('edit', 16)} Edit</button></div>` : ''}</div>

  <div class="grid-2">
    <div class="card"><div class="card-head"><h3>Line details</h3></div><div class="kv-grid">
      ${kv('Account', l.account)}${kv('Sl No', l.sl_no)}
      ${kv('Entity', l.entity)}${kv('Account Name', l.account_name)}
      ${kv('Product Category', l.product_category)}${kv('Product Type', l.product_type)}
      ${kv('Activation Date', l.activation_date ? fmtDate(l.activation_date) : null)}${kv('Status', l.status)}
      ${kv('Party ID', l.party_id)}${kv('Provider', l.provider)}
    </div></div>
    <div class="card"><div class="card-head"><h3>Plan &amp; holder</h3></div><div class="kv-grid">
      ${kv('Package', isNum(l.package) ? `AED ${l.package}` : l.package)}${kv('Limit', isNum(l.limit_amount) ? `AED ${l.limit_amount}` : l.limit_amount)}
      ${kv('Name (as in sheet)', l.holder_name)}${kv('Designation', l.designation)}
      ${kv('Linked employee', l.employee_id ? html`<a href="#/employees/${l.employee_id}">${l.employee_name}</a>` : null)}
      ${kv('Employee department', l.employee_department)}
    </div></div>
  </div>
  <div class="grid-2">
    <div class="card"><div class="card-head"><h3>Remarks</h3></div><p class="pad pre">${l.remarks || html`<span class="muted">No remarks</span>`}</p></div>
    <div class="card"><div class="card-head"><h3>Comments</h3></div><p class="pad pre">${l.comments || html`<span class="muted">No comments</span>`}</p></div>
  </div>`);
  const refresh = () => detail(ctx, id).catch(toastErr);
  el.querySelector('[data-edit]')?.addEventListener('click', () => lineForm(ctx, l, refresh));
  el.querySelector('[data-move]')?.addEventListener('click', async () => {
    const to = l.list === 'Active' ? 'Cancelled' : 'Active';
    if (!(await confirmBox(`Move to ${to}`, `Move ${fmtAcc(l.account) || 'this line'} to the ${to} list?`, { okText: 'Move' }))) return;
    api.put(`/isp/lines/${l.id}`, { list: to }).then(() => { toast(`Moved to ${to}`); refresh(); }).catch(toastErr);
  });
  el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!(await confirmBox('Delete line', 'Delete this line permanently?', { danger: true, okText: 'Delete' }))) return;
    api.del(`/isp/lines/${l.id}`).then(() => { toast('Line deleted'); location.hash = back; }).catch(toastErr);
  });
}

export async function render(ctx) {
  const { el, can } = ctx;
  if (!can('isp.view')) { location.hash = '#/my'; return; }
  if (ctx.params[0] === 'line' && ctx.params[1]) return detail(ctx, ctx.params[1]);
  const tab = ctx.params[0] === 'contacts' ? 'contacts' : ctx.query.list === 'Cancelled' ? 'Cancelled' : 'Active';
  const manage = can('isp.manage');
  el.innerHTML = str(spinner());
  const sum = await api.get('/isp/summary');
  if (!ctx.alive()) return;
  const pkgTotal = sum.byEntity.reduce((a, e) => a + e.package_total, 0);

  el.innerHTML = str(html`
  <div class="page-head"><div><h2>ISP &amp; Telecom</h2><p class="muted">Mobile numbers, internet and landlines across Alpago Group.</p></div>
    <div class="actions">${tab !== 'contacts' ? html`<button class="btn" data-export>${icon('download', 17)} Export CSV</button>` : ''}
      ${manage ? html`<button class="btn" data-import>${icon('file', 17)} Import sheet</button>
        <button class="btn btn-primary" data-add>${icon('plus', 18)} ${tab === 'contacts' ? 'Add contact' : 'Add line'}</button>` : ''}</div></div>

  <section class="kpis">
    <a class="card kpi" href="#/isp"><div class="kpi-ic tone-blue">${icon('phone', 28)}</div><div><span class="kpi-label">Active lines</span><b class="kpi-val">${fmtNum(sum.totals.Active || 0)}</b></div></a>
    <div class="card kpi"><div class="kpi-ic tone-green">${icon('key', 28)}</div><div><span class="kpi-label">Monthly packages</span><b class="kpi-val">AED ${fmtNum(pkgTotal)}</b><span class="muted small">active lines with a numeric package</span></div></div>
    <a class="card kpi" href="#/isp?list=Cancelled"><div class="kpi-ic tone-orange">${icon('x', 28)}</div><div><span class="kpi-label">Cancelled</span><b class="kpi-val">${fmtNum(sum.totals.Cancelled || 0)}</b></div></a>
    <a class="card kpi" href="#/isp/contacts"><div class="kpi-ic tone-purple">${icon('users', 28)}</div><div><span class="kpi-label">B2B contacts</span><b class="kpi-val">${fmtNum(sum.contacts)}</b></div></a>
  </section>

  <div class="seg">
    <a href="#/isp" class="${tab === 'Active' ? 'active' : ''}">${icon('phone', 16)} Active</a>
    <a href="#/isp?list=Cancelled" class="${tab === 'Cancelled' ? 'active' : ''}">${icon('x', 16)} Cancelled</a>
    <a href="#/isp/contacts" class="${tab === 'contacts' ? 'active' : ''}">${icon('users', 16)} B2B contacts</a>
  </div>
  <div class="card" data-body>${spinner()}</div>`);

  const body = el.querySelector('[data-body]');
  el.querySelector('[data-import]')?.addEventListener('click', () => importModal(() => ctx.reload()));
  el.querySelector('[data-export]')?.addEventListener('click', () => api.download(`/isp/lines/export.csv?list=${tab}`, `isp-${tab.toLowerCase()}-lines.csv`).catch(toastErr));

  if (tab === 'contacts') {
    const loadC = async () => {
      const { rows } = await api.get('/isp/contacts');
      body.innerHTML = str(rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Contact</th><th>Entities</th><th>Phone</th><th>Provider</th><th></th></tr></thead>
        <tbody>${rows.map((c) => html`<tr><td><div class="cell-user">${avatar(c.name, 34)}<div><b>${c.name}</b><span class="muted small">${c.email || 'No email'}</span></div></div></td>
          <td>${(c.entities || '').split(',').filter(Boolean).map((e) => html`<span class="pill pill-sm">${e.trim()}</span> `)}</td>
          <td class="nowrap">${c.phone || '—'}</td><td>${badge(c.provider, 'slate')}</td>
          <td class="row-actions nowrap">${manage ? html`<button class="icon-btn" data-edit="${c.id}" title="Edit">${icon('edit', 16)}</button><button class="icon-btn" data-del="${c.id}" title="Delete">${icon('trash', 16)}</button>` : ''}</td></tr>`)}</tbody></table></div>`
        : empty('No B2B contacts yet', 'users'));
      body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => contactForm(rows.find((r) => r.id === +b.dataset.edit), loadC)));
      body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        if (await confirmBox('Delete contact', 'Delete this B2B contact?', { danger: true, okText: 'Delete' })) api.del(`/isp/contacts/${b.dataset.del}`).then(loadC).catch(toastErr);
      }));
    };
    el.querySelector('[data-add]')?.addEventListener('click', () => contactForm(null, loadC));
    return loadC();
  }

  const q = { list: tab, ...ctx.query };
  const st = { page: 1, pageSize: 25, sort: 'sheet', dir: 'asc', type: ctx.query.type || '' };
  const cats = sum.byCategory.map((c) => c.category).filter((c) => c !== '(blank)');
  body.innerHTML = str(html`<div class="filters">
      <div class="search">${icon('search', 17)}<input name="q" placeholder="Search number, name, designation, remarks…" value="${q.q || ''}"></div>
      <select name="type"><option value="">All types</option>${['Mobile', 'Internet', 'Landline', 'Other'].map((t) => html`<option ${t === st.type ? 'selected' : ''}>${t}</option>`)}</select>
      <select name="entity"><option value="">All entities</option>${[...ENTITIES, '(blank)'].map((e) => html`<option ${e === q.entity ? 'selected' : ''} value="${e}">${e === '(blank)' ? 'No entity' : e}</option>`)}</select>
      <select name="category"><option value="">All categories</option>${cats.map((c) => html`<option ${c === q.category ? 'selected' : ''}>${c}</option>`)}</select>
    </div><div data-results>${spinner()}</div>`);
  const results = body.querySelector('[data-results]');
  let all = [];
  const SORTS = {
    sheet: (r) => r.sort_order, number: (r) => String(r.account || ''), holder: (r) => (r.employee_name || r.holder_name || '').toUpperCase(),
    entity: (r) => r.entity || '', package: (r) => (isNum(r.package) ? Number(r.package) : -1), date: (r) => r.activation_date || '',
  };
  const draw = () => {
    let rows = st.type ? all.filter((r) => lineType(r) === st.type) : all;
    const key = SORTS[st.sort];
    rows = [...rows].sort((a, b) => { const x = key(a); const y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * (st.dir === 'asc' ? 1 : -1); });
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / st.pageSize));
    st.page = Math.min(st.page, pages);
    const view = rows.slice((st.page - 1) * st.pageSize, st.page * st.pageSize);
    const th = (k, label) => html`<th class="sortable ${st.sort === k ? `sorted ${st.dir}` : ''}" data-sort="${k}">${label}</th>`;
    results.innerHTML = str(total ? html`<div class="table-wrap"><table class="table">
      <thead><tr>${th('number', 'Number')}${th('holder', 'Assigned to')}${th('entity', 'Entity')}<th>Category</th>${th('package', 'Package')}${th('date', 'Activated')}<th>Status</th><th></th></tr></thead>
      <tbody>${view.map((r) => { const type = lineType(r); const notes = [r.remarks, r.comments].filter(Boolean).join('\n'); return html`<tr data-href="#/isp/line/${r.id}">
        <td><div class="cell-asset"><span class="thumb sm tone-${TYPE_TONE[type]}">${icon(TYPE_ICON[type], 16)}</span>
          <div><b class="mono">${fmtAcc(r.account) || '—'}</b><span class="muted small">${type}${r.product_type ? ` · ${r.product_type}` : ''}${r.sl_no ? ` · #${r.sl_no}` : ''}</span></div></div></td>
        <td>${r.employee_id ? html`<div class="cell-user">${avatar(r.employee_name, 30)}<div><b>${r.employee_name}</b><span class="muted small">${r.designation || ''}</span></div></div>`
          : r.holder_name ? html`<div><b>${r.holder_name}</b><span class="muted small block">${r.designation || ''}</span></div>`
          : html`<span class="muted">${r.designation || '—'}</span>`}</td>
        <td class="muted">${r.entity || '—'}</td>
        <td>${r.product_category ? badge(r.product_category, 'slate') : html`<span class="muted">—</span>`}</td>
        <td class="nowrap">${isNum(r.package) ? html`<b>AED ${r.package}</b>` : (r.package || html`<span class="muted">—</span>`)}${isNum(r.limit_amount) && Number(r.limit_amount) > 0 ? html`<span class="muted small block">Limit AED ${r.limit_amount}</span>` : ''}</td>
        <td class="nowrap muted">${r.activation_date ? fmtDate(r.activation_date) : '—'}</td>
        <td>${r.list === 'Cancelled' ? badge('Cancelled', 'gray') : badge(r.status ? r.status.charAt(0) + r.status.slice(1).toLowerCase() : 'Active', 'green')}</td>
        <td class="row-actions nowrap">${notes ? html`<span class="note-dot" title="${notes}">${icon('message', 15)}</span>` : ''}${icon('chevRight', 16)}</td></tr>`; })}</tbody></table></div>
      ${pager(total, st.page, st.pageSize)}` : empty('No lines match these filters', 'phone'));
    results.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.href; }));
    results.querySelectorAll('[data-sort]').forEach((t) => t.addEventListener('click', () => {
      st.dir = st.sort === t.dataset.sort && st.dir === 'asc' ? 'desc' : 'asc'; st.sort = t.dataset.sort; draw();
    }));
    results.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { st.page = +b.dataset.page; draw(); }));
  };
  const load = async () => {
    all = (await api.get(`/isp/lines?${new URLSearchParams(Object.entries(q).filter(([, v]) => v)).toString()}`)).rows;
    if (!ctx.alive()) return;
    st.page = 1; draw();
  };
  body.querySelector('[name=q]').addEventListener('input', debounce((e) => { q.q = e.target.value; load().catch(toastErr); }, 300));
  body.querySelector('[name=type]').addEventListener('change', (e) => { st.type = e.target.value; st.page = 1; draw(); });
  body.querySelectorAll('select[name=entity], select[name=category]').forEach((s) => s.addEventListener('change', () => { q[s.name] = s.value; load().catch(toastErr); }));
  el.querySelector('[data-add]')?.addEventListener('click', () => lineForm(ctx, null, () => ctx.reload()));
  await load();
}
