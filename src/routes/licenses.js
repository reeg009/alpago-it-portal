const router = require('express').Router();
const { query, audit } = require('../db');
const { requirePerm } = require('../auth');
const { wrap, bad, notFound, nil, int, buildUpdate } = require('../util');

const FIELDS = ['name', 'vendor', 'license_type', 'license_key', 'seats_total', 'cost', 'billing_cycle', 'purchase_date', 'renewal_date', 'entity_id', 'notes'];

const LIST = `
  SELECT l.*, e.name AS entity_name,
         (SELECT COUNT(*)::int FROM license_assignments la WHERE la.license_id = l.id) AS seats_used,
         (l.renewal_date - CURRENT_DATE) AS days_to_renewal
    FROM licenses l LEFT JOIN entities e ON e.id = l.entity_id`;

router.get('/', requirePerm('licenses.view'), wrap(async (req, res) => {
  const vals = [];
  const where = [];
  if (req.query.q) { vals.push(`%${req.query.q}%`); where.push(`(l.name ILIKE $1 OR l.vendor ILIKE $1)`); }
  if (req.query.renewing === '30') where.push('l.renewal_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30');
  const { rows } = await query(`${LIST} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.renewal_date NULLS LAST, l.name`, vals);
  // hide keys from people who cannot manage licenses
  if (!req.can('licenses.manage')) rows.forEach((r) => { r.license_key = r.license_key ? '••••••••' : null; });
  res.json({ rows });
}));

router.get('/:id', requirePerm('licenses.view'), wrap(async (req, res) => {
  const id = int(req.params.id);
  const l = (await query(`${LIST} WHERE l.id = $1`, [id])).rows[0];
  if (!l) throw notFound('License');
  if (!req.can('licenses.manage') && l.license_key) l.license_key = '••••••••';
  const users = (await query(
    `SELECT u.id, u.full_name, u.email, u.department, la.assigned_at FROM license_assignments la
       JOIN users u ON u.id = la.user_id WHERE la.license_id = $1 ORDER BY u.full_name`, [id])).rows;
  res.json({ ...l, users });
}));

router.post('/', requirePerm('licenses.manage'), wrap(async (req, res) => {
  const b = req.body;
  if (!b.name) throw bad('License name is required');
  const cols = FIELDS.filter((f) => b[f] !== undefined && b[f] !== '');
  const { rows } = await query(
    `INSERT INTO licenses (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
    cols.map((f) => nil(b[f])));
  await audit(req.user.id, 'license.create', 'license', rows[0].id, { name: rows[0].name });
  res.status(201).json(rows[0]);
}));

router.put('/:id', requirePerm('licenses.manage'), wrap(async (req, res) => {
  const id = int(req.params.id);
  const upd = buildUpdate('licenses', id, req.body, FIELDS, { updated_at: new Date() });
  if (!upd) throw bad('Nothing to update');
  const { rows } = await query(upd.text, upd.values);
  if (!rows[0]) throw notFound('License');
  await audit(req.user.id, 'license.update', 'license', id);
  res.json(rows[0]);
}));

router.delete('/:id', requirePerm('licenses.manage'), wrap(async (req, res) => {
  const { rowCount } = await query('DELETE FROM licenses WHERE id = $1', [int(req.params.id)]);
  if (!rowCount) throw notFound('License');
  await audit(req.user.id, 'license.delete', 'license', int(req.params.id));
  res.json({ ok: true });
}));

router.post('/:id/assign', requirePerm('licenses.manage'), wrap(async (req, res) => {
  const id = int(req.params.id);
  const userId = int(req.body.user_id);
  if (!userId) throw bad('Select an employee');
  const l = (await query(`${LIST} WHERE l.id = $1`, [id])).rows[0];
  if (!l) throw notFound('License');
  if (l.seats_used >= l.seats_total) throw bad(`All ${l.seats_total} seats are in use`);
  const { rowCount } = await query('INSERT INTO license_assignments (license_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, userId]);
  if (!rowCount) throw bad('Employee already has this license');
  await audit(req.user.id, 'license.assign', 'license', id, { user_id: userId });
  res.json({ ok: true });
}));

router.delete('/:id/assign/:userId', requirePerm('licenses.manage'), wrap(async (req, res) => {
  await query('DELETE FROM license_assignments WHERE license_id = $1 AND user_id = $2', [int(req.params.id), int(req.params.userId)]);
  await audit(req.user.id, 'license.unassign', 'license', int(req.params.id), { user_id: int(req.params.userId) });
  res.json({ ok: true });
}));

module.exports = router;
