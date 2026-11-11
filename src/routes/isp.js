// ISP & Telecom: numbers/lines and provider B2B contacts, mirroring the Etisalat sheet.
const express = require('express');
const ExcelJS = require('exceljs');
const router = express.Router();
const { query, tx, audit } = require('../db');
const { requirePerm } = require('../auth');
const { wrap, bad, notFound, nil, int, toCsv } = require('../util');
const { makeMatcher } = require('../asset-import');

// Sheet column order (used for the table, CSV export and import)
const COLUMNS = [
  ['sl_no', 'Sl No'], ['entity', 'Entity'], ['account', 'Account'], ['account_name', 'Account Name'],
  ['product_category', 'Product Category'], ['product_type', 'Product Type'], ['activation_date', 'Activation Date'],
  ['status', 'Status'], ['party_id', 'Party ID'], ['limit_amount', 'Limit'], ['package', 'Package'],
  ['holder_name', 'Name'], ['designation', 'Designation'], ['remarks', 'Remarks'], ['comments', 'Comments'],
];
const FIELDS = [...COLUMNS.map((c) => c[0]), 'provider', 'list', 'employee_id'];

// Identity-document details are masked (Emirates ID numbers, DOB, ID expiry)
function scrub(s) {
  if (!s) return s;
  return s.replace(/784[-\s]?\d{4}[-\s]?\d{7}[-\s]?\d/g, '[ID removed]')
    .replace(/\b(DOB|DATE OF BIRTH)\s*[:\-]?\s*[\d/.-]+/gi, '[DOB removed]')
    .replace(/\b(EID|ID)\s*(EXPIRY|EXPIRY DATE|EXP)\s*[:\-]?\s*[\d/.-]+/gi, '[ID expiry removed]')
    .replace(/\bID Number\s*:\s*\[ID removed\]/gi, '[ID removed]');
}

// ---------- read ----------
router.get('/lines', requirePerm('isp.view'), wrap(async (req, res) => {
  const q = req.query;
  const where = [];
  const vals = [];
  const add = (sql, v) => { vals.push(v); where.push(sql.replace('?', `$${vals.length}`)); };
  add('l.list = ?', q.list === 'Cancelled' ? 'Cancelled' : 'Active');
  if (q.provider) add('l.provider = ?', q.provider);
  if (q.entity === '(blank)') where.push("COALESCE(l.entity, '') = ''");
  else if (q.entity) add('l.entity = ?', q.entity);
  if (q.category === '(blank)') where.push("COALESCE(l.product_category, '') = ''");
  else if (q.category) add('l.product_category ILIKE ?', q.category);
  if (q.q) {
    vals.push(`%${q.q}%`);
    const p = `$${vals.length}`;
    where.push(`(l.account ILIKE ${p} OR l.holder_name ILIKE ${p} OR l.designation ILIKE ${p} OR l.remarks ILIKE ${p} OR l.comments ILIKE ${p} OR l.sl_no ILIKE ${p})`);
  }
  const { rows } = await query(
    `SELECT l.*, u.full_name AS employee_name FROM isp_lines l LEFT JOIN users u ON u.id = l.employee_id
      WHERE ${where.join(' AND ')} ORDER BY l.sort_order, l.id`, vals);
  res.json({ rows });
}));

router.get('/summary', requirePerm('isp.view'), wrap(async (req, res) => {
  const tot = (await query(`SELECT list, COUNT(*)::int AS n FROM isp_lines GROUP BY list`)).rows;
  const byEntity = (await query(
    `SELECT COALESCE(NULLIF(entity, ''), '(blank)') AS entity, COUNT(*)::int AS lines,
            COALESCE(SUM(CASE WHEN package ~ '^\\s*\\d+(\\.\\d+)?\\s*$' THEN package::numeric END), 0)::float AS package_total
       FROM isp_lines WHERE list = 'Active' GROUP BY 1 ORDER BY lines DESC`)).rows;
  const byCategory = (await query(
    `SELECT COALESCE(NULLIF(product_category, ''), '(blank)') AS category, COUNT(*)::int AS lines
       FROM isp_lines WHERE list = 'Active' GROUP BY 1 ORDER BY lines DESC`)).rows;
  const providers = (await query('SELECT DISTINCT provider FROM isp_lines ORDER BY 1')).rows.map((r) => r.provider);
  const contacts = (await query('SELECT COUNT(*)::int AS n FROM isp_contacts')).rows[0].n;
  res.json({ totals: Object.fromEntries(tot.map((r) => [r.list, r.n])), byEntity, byCategory, providers, contacts });
}));

router.get('/line/:id', requirePerm('isp.view'), wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT l.*, u.full_name AS employee_name, u.department AS employee_department, u.job_title AS employee_title
       FROM isp_lines l LEFT JOIN users u ON u.id = l.employee_id WHERE l.id = $1`, [int(req.params.id)]);
  if (!rows[0]) throw notFound('Line');
  res.json(rows[0]);
}));

router.get('/lines/export.csv', requirePerm('isp.view'), wrap(async (req, res) => {
  const list = req.query.list === 'Cancelled' ? 'Cancelled' : 'Active';
  const { rows } = await query(
    `SELECT ${COLUMNS.map(([k, label]) => `${k === 'activation_date' ? "to_char(activation_date, 'YYYY-MM-DD')" : k} AS "${label}"`).join(', ')}, provider AS "Provider"
       FROM isp_lines WHERE list = $1 ORDER BY sort_order, id`, [list]);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="isp-${list.toLowerCase()}-lines.csv"`);
  res.send(toCsv(rows));
}));

router.get('/contacts', requirePerm('isp.view'), wrap(async (req, res) => {
  res.json({ rows: (await query('SELECT * FROM isp_contacts ORDER BY provider, sort_order, id')).rows });
}));

// ---------- write ----------
function clean(body) {
  const o = {};
  for (const f of FIELDS) if (body[f] !== undefined) o[f] = f === 'employee_id' ? int(body[f]) : nil(typeof body[f] === 'string' ? body[f].trim() : body[f]);
  if (o.remarks) o.remarks = scrub(o.remarks);
  if (o.comments) o.comments = scrub(o.comments);
  if (o.list && !['Active', 'Cancelled'].includes(o.list)) o.list = 'Active';
  return o;
}

router.post('/lines', requirePerm('isp.manage'), wrap(async (req, res) => {
  const o = clean(req.body);
  if (!o.account && !o.holder_name && !o.designation) throw bad('Enter at least an account/number, name or designation');
  o.provider = o.provider || 'Etisalat';
  o.list = o.list || 'Active';
  const next = (await query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM isp_lines WHERE list = $1', [o.list])).rows[0].n;
  const keys = [...Object.keys(o), 'sort_order'];
  const { rows } = await query(`INSERT INTO isp_lines (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
    [...Object.values(o), next]);
  await audit(req.user.id, 'isp.create', 'isp_line', rows[0].id, { account: o.account });
  res.status(201).json(rows[0]);
}));

router.put('/lines/:id', requirePerm('isp.manage'), wrap(async (req, res) => {
  const id = int(req.params.id);
  const o = clean(req.body);
  const keys = Object.keys(o);
  if (!keys.length) throw bad('Nothing to update');
  const { rows } = await query(`UPDATE isp_lines SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')}, updated_at = now() WHERE id = $${keys.length + 1} RETURNING *`,
    [...Object.values(o), id]);
  if (!rows[0]) throw notFound('Line');
  await audit(req.user.id, 'isp.update', 'isp_line', id, { changed: keys });
  res.json(rows[0]);
}));

router.delete('/lines/:id', requirePerm('isp.manage'), wrap(async (req, res) => {
  const id = int(req.params.id);
  const { rowCount } = await query('DELETE FROM isp_lines WHERE id = $1', [id]);
  if (!rowCount) throw notFound('Line');
  await audit(req.user.id, 'isp.delete', 'isp_line', id);
  res.json({ ok: true });
}));

router.post('/contacts', requirePerm('isp.manage'), wrap(async (req, res) => {
  const b = req.body;
  if (!b.name) throw bad('Name is required');
  const { rows } = await query('INSERT INTO isp_contacts (provider, sl_no, name, entities, email, phone) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [nil(b.provider) || 'Etisalat', nil(b.sl_no), b.name.trim(), nil(b.entities), nil(b.email), nil(b.phone)]);
  res.status(201).json(rows[0]);
}));
router.put('/contacts/:id', requirePerm('isp.manage'), wrap(async (req, res) => {
  const b = req.body;
  const { rows } = await query(
    'UPDATE isp_contacts SET provider = COALESCE($2, provider), sl_no = $3, name = COALESCE($4, name), entities = $5, email = $6, phone = $7 WHERE id = $1 RETURNING *',
    [int(req.params.id), nil(b.provider), nil(b.sl_no), nil(b.name), nil(b.entities), nil(b.email), nil(b.phone)]);
  if (!rows[0]) throw notFound('Contact');
  res.json(rows[0]);
}));
router.delete('/contacts/:id', requirePerm('isp.manage'), wrap(async (req, res) => {
  await query('DELETE FROM isp_contacts WHERE id = $1', [int(req.params.id)]);
  res.json({ ok: true });
}));

// ---------- import (replaces this provider's lists with the sheet) ----------
const hkey = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const HEAD = {
  'sl no': 'sl_no', entity: 'entity', account: 'account', 'account number': 'account', 'account name': 'account_name',
  'product category': 'product_category', 'product type': 'product_type', 'activation date': 'activation_date',
  status: 'status', 'party id': 'party_id', limit: 'limit_amount', cap: 'limit_amount', package: 'package',
  name: 'holder_name', 'emp name': 'holder_name', 'employee name': 'holder_name', designation: 'designation',
  remarks: 'remarks', comments: 'comments',
};
function cellText(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.richText) return cellText(v.richText.map((t) => t.text).join(''));
    if ('result' in v) return cellText(v.result);
    if ('text' in v) return cellText(v.text);
    return null;
  }
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
}

async function parseSheet(buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw Object.assign(new Error('That file could not be read as an Excel (.xlsx) workbook'), { status: 400 }); }
  const ws = wb.worksheets.find((w) => /etisalat|isp|telecom|du\b/i.test(w.name))
    || wb.worksheets.find((w) => { let ok = false; w.eachRow((r) => { if (r.values.some((v) => hkey(cellText(v)) === 'product category')) ok = true; }); return ok; });
  if (!ws) throw Object.assign(new Error('No ISP sheet found (expected a sheet named "Etisalat" with a "Product Category" column)'), { status: 400 });
  const provider = /du\b/i.test(ws.name) && !/etisalat/i.test(ws.name) ? 'du' : 'Etisalat';
  const lines = []; const contacts = [];
  let cols = null; let section = 'Active'; let masked = 0; let order = 0; let contact = null;
  for (let n = 1; n <= ws.rowCount; n++) {
    const vals = ws.getRow(n).values.map(cellText); // 1-based
    const filled = vals.filter(Boolean);
    if (!filled.length) continue;
    const keys = vals.map(hkey);
    if (keys.includes('status') && (keys.includes('product category') || keys.includes('account') || keys.includes('account number'))) {
      cols = {}; keys.forEach((k, i) => { const f = HEAD[k]; if (f && !cols[f]) cols[f] = i; });
      // the Cancelled block has no "Entity" heading but entities are typed in that column
      if (!cols.entity && cols.sl_no && cols.account && cols.account - cols.sl_no === 2) cols.entity = cols.sl_no + 1;
      continue;
    }
    const uniq = [...new Set(filled)];
    if (uniq.length === 1 && /^cancel+ed$/i.test(uniq[0])) { section = 'Cancelled'; continue; }
    if (uniq.length === 1 && /b2b/i.test(uniq[0])) { section = 'B2B'; contact = null; continue; }
    if (section === 'B2B') {
      // rows: [sl, , NAME, ..., email (col 10), ..., phone (col 13)]  followed by entity rows
      const email = vals.find((v) => v && v.includes('@')) || null;
      const name = vals[3];
      if (vals[1] || email) {
        contact = { sl_no: vals[1], name: name || '(no name)', email, phone: vals.slice(4).find((v) => v && /^\+?[\d\s]{7,}$/.test(v) && !v.includes('@')) || null, entities: [] };
        contacts.push(contact);
      } else if (contact && name) contact.entities.push(name);
      continue;
    }
    if (!cols) continue;
    const g = (f) => (cols[f] ? vals[cols[f]] : null);
    const rec = { list: section, provider };
    for (const [f] of COLUMNS) rec[f] = g(f);
    if (!rec.account && !rec.package && !rec.designation && !rec.product_category && !rec.account_name) continue; // e.g. a stray name-only row
    for (const f of ['remarks', 'comments', 'holder_name', 'designation']) {
      if (rec[f]) { const s = scrub(rec[f]); if (s !== rec[f]) masked++; rec[f] = s; }
    }
    if (rec.activation_date && !/^\d{4}-\d{2}-\d{2}$/.test(rec.activation_date)) rec.activation_date = null;
    rec.sort_order = ++order;
    lines.push(rec);
  }
  if (!lines.length) throw Object.assign(new Error('No ISP lines found in the sheet'), { status: 400 });
  return { sheet: ws.name, provider, lines, contacts: contacts.map((c) => ({ ...c, entities: c.entities.join(', ') || null })), masked };
}

router.post('/import', requirePerm('isp.manage'), express.raw({ type: () => true, limit: '15mb' }), wrap(async (req, res) => {
  if (!req.body || !req.body.length) throw bad('Upload the workbook containing the Etisalat sheet');
  const { sheet, provider, lines, contacts, masked } = await parseSheet(req.body);
  const commit = req.query.commit === '1';
  const people = (await query('SELECT id, full_name, is_active FROM users')).rows;
  const match = makeMatcher(people);
  let linked = 0;
  for (const l of lines) {
    const m = l.holder_name ? match(l.holder_name) : null;
    l.employee_id = m?.person && !m.weak ? m.person.id : null;
    if (l.employee_id) linked++;
  }
  const existing = (await query('SELECT COUNT(*)::int AS n FROM isp_lines WHERE provider = $1', [provider])).rows[0].n;
  const report = {
    sheet, provider, active: lines.filter((l) => l.list === 'Active').length, cancelled: lines.filter((l) => l.list === 'Cancelled').length,
    contacts: contacts.length, linkedToEmployees: linked, masked, replaces: existing, committed: commit,
  };
  if (commit) {
    await tx(async (c) => {
      await c.query('DELETE FROM isp_lines WHERE provider = $1', [provider]);
      await c.query('DELETE FROM isp_contacts WHERE provider = $1', [provider]);
      for (const l of lines) {
        const keys = Object.keys(l);
        await c.query(`INSERT INTO isp_lines (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(l));
      }
      let i = 0;
      for (const ct of contacts) {
        await c.query('INSERT INTO isp_contacts (provider, sl_no, name, entities, email, phone, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [provider, ct.sl_no, ct.name, ct.entities, ct.email, ct.phone, ++i]);
      }
    });
    await audit(req.user.id, 'isp.import', 'isp_line', null, { provider, lines: lines.length, contacts: contacts.length });
  }
  res.json(report);
}));

module.exports = router;
module.exports.COLUMNS = COLUMNS;
