const express = require('express');
const router = express.Router();
const assetImport = require('../asset-import');
const { query, tx, audit } = require('../db');
const { requirePerm } = require('../auth');
const { wrap, bad, notFound, nil, int, buildUpdate, toCsv, paging } = require('../util');

const FIELDS = ['asset_tag', 'name', 'category', 'brand', 'model', 'serial_number', 'status', 'condition', 'entity_id',
  'location', 'purchase_date', 'purchase_cost', 'supplier', 'warranty_expiry', 'notes',
  'purchase_ref', 'os', 'processor', 'ram', 'storage', 'graphics', 'remote_id', 'review_flag'];
const SORTS = { asset_tag: 'a.asset_tag', name: 'a.name', category: 'a.category', status: 'a.status', entity: 'e.name',
  assigned: 'u.full_name', warranty: 'a.warranty_expiry', updated: 'a.updated_at' };

const BASE = `
  FROM assets a
  LEFT JOIN entities e ON e.id = a.entity_id
  LEFT JOIN users u ON u.id = a.assigned_to`;
const COLS = `a.*, e.name AS entity_name, u.full_name AS assigned_name, u.email AS assigned_email`;

function filters(q) {
  const where = [];
  const vals = [];
  const add = (sql, v) => { vals.push(v); where.push(sql.replace('?', `$${vals.length}`)); };
  if (q.q) {
    vals.push(`%${q.q}%`);
    const p = `$${vals.length}`;
    where.push(`(a.asset_tag ILIKE ${p} OR a.name ILIKE ${p} OR a.serial_number ILIKE ${p} OR a.model ILIKE ${p} OR u.full_name ILIKE ${p} OR a.sheet_holder ILIKE ${p} OR a.purchase_ref ILIKE ${p})`);
  }
  if (q.category) add('a.category = ?', q.category);
  if (q.status) add('a.status = ?', q.status);
  if (q.entity_id) add('a.entity_id = ?', int(q.entity_id));
  if (q.assigned_to) add('a.assigned_to = ?', int(q.assigned_to));
  if (q.review === '1') where.push('a.review_flag IS NOT NULL');
  if (q.warranty === 'expiring') where.push("a.warranty_expiry BETWEEN CURRENT_DATE AND CURRENT_DATE + 90 AND a.status <> 'Retired'");
  if (q.warranty === 'expired') where.push('a.warranty_expiry < CURRENT_DATE');
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', vals };
}

router.get('/', requirePerm('assets.view'), wrap(async (req, res) => {
  const { where, vals } = filters(req.query);
  const { pageSize, offset, page } = paging(req);
  const sort = SORTS[req.query.sort] || 'a.asset_tag';
  const dir = req.query.dir === 'desc' ? 'DESC' : 'ASC';
  const total = (await query(`SELECT COUNT(*)::int AS n ${BASE} ${where}`, vals)).rows[0].n;
  const { rows } = await query(
    `SELECT ${COLS} ${BASE} ${where} ORDER BY ${sort} ${dir} NULLS LAST, a.id LIMIT ${pageSize} OFFSET ${offset}`, vals);
  res.json({ rows, total, page, pageSize });
}));

router.get('/export.csv', requirePerm('assets.view'), wrap(async (req, res) => {
  const { where, vals } = filters(req.query);
  const { rows } = await query(
    `SELECT a.asset_tag, a.name, a.category, a.brand, a.model, a.serial_number, a.status, a.condition, e.name AS entity,
            u.full_name AS assigned_to, a.location, a.purchase_date, a.purchase_cost, a.supplier, a.warranty_expiry, a.notes
     ${BASE} ${where} ORDER BY a.asset_tag`, vals);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="alpago-assets.csv"');
  res.send(toCsv(rows));
}));

router.get('/next-tag', requirePerm('assets.manage'), wrap(async (req, res) => {
  const prefix = { Laptop: 'LT', Desktop: 'DT', Monitor: 'MN', Mobile: 'MB', Printer: 'PR', Network: 'NW' }[req.query.category] || 'GN';
  const { rows } = await query(
    "SELECT COALESCE(MAX(substring(asset_tag FROM '(\\d+)$')::int), 0) + 1 AS n FROM assets WHERE asset_tag LIKE $1", [`ALP-${prefix}-%`]);
  res.json({ tag: `ALP-${prefix}-${String(rows[0].n).padStart(5, '0')}` });
}));

// IT asset workbook import (.xlsx). ?commit=1 writes; otherwise a dry-run preview.
router.post('/import', requirePerm('assets.manage'), express.raw({ type: () => true, limit: '15mb' }), wrap(async (req, res) => {
  if (!req.body || !req.body.length) throw bad('Upload the IT asset details .xlsx file');
  res.json(await assetImport.runImport(req.body, { commit: req.query.commit === '1', userId: req.user.id }));
}));

router.get('/:id', wrap(async (req, res) => {
  const { rows } = await query(`SELECT ${COLS} ${BASE} WHERE a.id = $1`, [int(req.params.id)]);
  const a = rows[0];
  if (!a) throw notFound('Asset');
  if (!req.can('assets.view') && a.assigned_to !== req.user.id) throw notFound('Asset');
  const history = (await query(
    `SELECT h.*, fu.full_name AS from_user_name, tu.full_name AS to_user_name, fe.name AS from_entity_name,
            te.name AS to_entity_name, pb.full_name AS performed_by_name
       FROM asset_history h
       LEFT JOIN users fu ON fu.id = h.from_user LEFT JOIN users tu ON tu.id = h.to_user
       LEFT JOIN entities fe ON fe.id = h.from_entity LEFT JOIN entities te ON te.id = h.to_entity
       LEFT JOIN users pb ON pb.id = h.performed_by
      WHERE h.asset_id = $1 ORDER BY h.created_at DESC, h.id DESC`, [a.id])).rows;
  const tickets = (await query('SELECT id, ticket_no, subject, status, priority, created_at FROM tickets WHERE asset_id = $1 ORDER BY created_at DESC', [a.id])).rows;
  res.json({ ...a, history, tickets });
}));

router.post('/', requirePerm('assets.manage'), wrap(async (req, res) => {
  const b = req.body;
  if (!b.asset_tag || !b.name || !b.category) throw bad('Asset tag, name and category are required');
  const row = await tx(async (c) => {
    const cols = FIELDS.filter((f) => b[f] !== undefined && b[f] !== '');
    const vals = cols.map((f) => nil(b[f]));
    const { rows } = await c.query(
      `INSERT INTO assets (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, vals);
    await c.query("INSERT INTO asset_history (asset_id, action, to_entity, performed_by, note) VALUES ($1,'Created',$2,$3,$4)",
      [rows[0].id, rows[0].entity_id, req.user.id, 'Asset registered']);
    return rows[0];
  });
  await audit(req.user.id, 'asset.create', 'asset', row.id, { asset_tag: row.asset_tag });
  res.status(201).json(row);
}));

router.put('/:id', requirePerm('assets.manage'), wrap(async (req, res) => {
  const id = int(req.params.id);
  const before = (await query('SELECT * FROM assets WHERE id = $1', [id])).rows[0];
  if (!before) throw notFound('Asset');
  const fields = FIELDS.filter((f) => f !== 'status' || req.body.status !== 'Assigned'); // assignment goes through /assign
  const upd = buildUpdate('assets', id, req.body, fields, { updated_at: new Date() });
  if (!upd) throw bad('Nothing to update');
  const { rows } = await query(upd.text, upd.values);
  const same = (a, b) => (a !== '' && b !== '' && !isNaN(a) && !isNaN(b) ? Number(a) === Number(b) : a === b);
  const changed = fields.filter((f) => req.body[f] !== undefined
    && !same(String(nil(req.body[f]) ?? ''), String(before[f] ?? '')));
  if (changed.length) {
    await query("INSERT INTO asset_history (asset_id, action, performed_by, note) VALUES ($1,'Updated',$2,$3)",
      [id, req.user.id, `Changed: ${changed.join(', ')}`]);
  }
  if (req.body.status === 'Retired' && before.assigned_to) {
    await query("UPDATE assets SET assigned_to = NULL, assigned_at = NULL WHERE id = $1", [id]);
  }
  await audit(req.user.id, 'asset.update', 'asset', id, { changed });
  res.json(rows[0]);
}));

router.post('/:id/assign', requirePerm('assets.assign'), wrap(async (req, res) => {
  const id = int(req.params.id);
  const userId = int(req.body.user_id);
  if (!userId) throw bad('Select an employee');
  const out = await tx(async (c) => {
    const a = (await c.query('SELECT * FROM assets WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!a) throw notFound('Asset');
    if (a.status === 'Retired') throw bad('Retired assets cannot be assigned');
    const u = (await c.query('SELECT id, entity_id FROM users WHERE id = $1 AND is_active', [userId])).rows[0];
    if (!u) throw bad('Employee not found or inactive');
    await c.query("UPDATE assets SET assigned_to = $1, assigned_at = now(), status = 'Assigned', sheet_holder = NULL, review_flag = NULL, updated_at = now() WHERE id = $2", [userId, id]);
    await c.query(`INSERT INTO asset_history (asset_id, action, from_user, to_user, performed_by, note)
                   VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, a.assigned_to ? 'Reassigned' : 'Assigned', a.assigned_to, userId, req.user.id, nil(req.body.note)]);
    return { ok: true };
  });
  await audit(req.user.id, 'asset.assign', 'asset', id, { user_id: userId });
  res.json(out);
}));

router.post('/:id/unassign', requirePerm('assets.assign'), wrap(async (req, res) => {
  const id = int(req.params.id);
  await tx(async (c) => {
    const a = (await c.query('SELECT * FROM assets WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!a) throw notFound('Asset');
    if (!a.assigned_to) throw bad('Asset is not assigned');
    await c.query("UPDATE assets SET assigned_to = NULL, assigned_at = NULL, status = $2, sheet_holder = NULL, review_flag = NULL, updated_at = now() WHERE id = $1",
      [id, req.body.status || 'In Stock']);
    await c.query("INSERT INTO asset_history (asset_id, action, from_user, performed_by, note) VALUES ($1,'Returned',$2,$3,$4)",
      [id, a.assigned_to, req.user.id, nil(req.body.note)]);
  });
  await audit(req.user.id, 'asset.unassign', 'asset', id);
  res.json({ ok: true });
}));

// Transfer between entities and/or locations, optionally to a new holder
router.post('/:id/transfer', requirePerm('assets.assign'), wrap(async (req, res) => {
  const id = int(req.params.id);
  const toEntity = int(req.body.entity_id);
  const toUser = int(req.body.user_id);
  const location = nil(req.body.location);
  if (!toEntity && !toUser && !location) throw bad('Choose a target entity, location or employee');
  await tx(async (c) => {
    const a = (await c.query('SELECT * FROM assets WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!a) throw notFound('Asset');
    if (a.status === 'Retired') throw bad('Retired assets cannot be transferred');
    await c.query(
      `UPDATE assets SET entity_id = COALESCE($2, entity_id), location = COALESCE($3, location),
              assigned_to = CASE WHEN $4::int IS NOT NULL THEN $4 ELSE assigned_to END,
              assigned_at = CASE WHEN $4::int IS NOT NULL THEN now() ELSE assigned_at END,
              status = CASE WHEN $4::int IS NOT NULL THEN 'Assigned' ELSE status END,
              updated_at = now()
        WHERE id = $1`, [id, toEntity, location, toUser]);
    await c.query(`INSERT INTO asset_history (asset_id, action, from_user, to_user, from_entity, to_entity, performed_by, note)
                   VALUES ($1,'Transferred',$2,$3,$4,$5,$6,$7)`,
      [id, a.assigned_to, toUser || a.assigned_to, a.entity_id, toEntity || a.entity_id, req.user.id,
       [location && `Location: ${location}`, nil(req.body.note)].filter(Boolean).join(' — ') || null]);
  });
  await audit(req.user.id, 'asset.transfer', 'asset', id, { entity_id: toEntity, user_id: toUser, location });
  res.json({ ok: true });
}));

router.post('/:id/confirm', requirePerm('assets.assign', 'assets.manage'), wrap(async (req, res) => {
  const id = int(req.params.id);
  const { rowCount } = await query('UPDATE assets SET review_flag = NULL, sheet_holder = NULL, updated_at = now() WHERE id = $1', [id]);
  if (!rowCount) throw notFound('Asset');
  await query("INSERT INTO asset_history (asset_id, action, performed_by, note) VALUES ($1,'Reviewed',$2,'Import review confirmed')", [id, req.user.id]);
  res.json({ ok: true });
}));

router.delete('/:id', requirePerm('assets.manage'), wrap(async (req, res) => {
  const id = int(req.params.id);
  const { rowCount } = await query('DELETE FROM assets WHERE id = $1', [id]);
  if (!rowCount) throw notFound('Asset');
  await audit(req.user.id, 'asset.delete', 'asset', id);
  res.json({ ok: true });
}));

module.exports = router;
