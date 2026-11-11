const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { query, audit } = require('../db');
const { requirePerm } = require('../auth');
const { wrap, bad, notFound, nil, int, buildUpdate, toCsv, paging } = require('../util');

const FIELDS = ['employee_code', 'full_name', 'email', 'entity_id', 'department', 'job_title', 'phone', 'location', 'is_active'];

const BASE = `FROM users u LEFT JOIN entities e ON e.id = u.entity_id JOIN roles r ON r.id = u.role_id`;
const COLS = `u.id, u.employee_code, u.full_name, u.email, u.entity_id, e.name AS entity_name, u.department, u.job_title,
              u.phone, u.location, u.is_active, u.can_login, u.role_id, r.name AS role_name, u.last_login_at, u.created_at,
              (SELECT COUNT(*)::int FROM assets a WHERE a.assigned_to = u.id) AS asset_count`;

function filters(q) {
  const where = [];
  const vals = [];
  if (q.q) {
    vals.push(`%${q.q}%`);
    where.push(`(u.full_name ILIKE $${vals.length} OR u.email ILIKE $${vals.length} OR u.employee_code ILIKE $${vals.length} OR u.department ILIKE $${vals.length})`);
  }
  if (q.entity_id) { vals.push(int(q.entity_id)); where.push(`u.entity_id = $${vals.length}`); }
  if (q.department) { vals.push(q.department); where.push(`u.department = $${vals.length}`); }
  if (q.active === 'true') where.push('u.is_active');
  if (q.active === 'false') where.push('NOT u.is_active');
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', vals };
}

router.get('/', requirePerm('employees.view'), wrap(async (req, res) => {
  const { where, vals } = filters(req.query);
  const { page, pageSize, offset } = paging(req);
  const total = (await query(`SELECT COUNT(*)::int AS n ${BASE} ${where}`, vals)).rows[0].n;
  const { rows } = await query(`SELECT ${COLS} ${BASE} ${where} ORDER BY u.full_name LIMIT ${pageSize} OFFSET ${offset}`, vals);
  res.json({ rows, total, page, pageSize });
}));

router.get('/export.csv', requirePerm('employees.view'), wrap(async (req, res) => {
  const { where, vals } = filters(req.query);
  const { rows } = await query(
    `SELECT u.employee_code, u.full_name, u.email, e.name AS entity, u.department, u.job_title, u.phone, u.location,
            r.name AS role, u.is_active ${BASE} ${where} ORDER BY u.full_name`, vals);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="alpago-employees.csv"');
  res.send(toCsv(rows));
}));

router.get('/:id', requirePerm('employees.view'), wrap(async (req, res) => {
  const id = int(req.params.id);
  const u = (await query(`SELECT ${COLS} ${BASE} WHERE u.id = $1`, [id])).rows[0];
  if (!u) throw notFound('Employee');
  const assets = (await query('SELECT id, asset_tag, name, category, status, assigned_at FROM assets WHERE assigned_to = $1 ORDER BY category', [id])).rows;
  const licenses = (await query(
    `SELECT l.id, l.name, l.vendor, la.assigned_at FROM license_assignments la JOIN licenses l ON l.id = la.license_id
      WHERE la.user_id = $1 ORDER BY l.name`, [id])).rows;
  const tickets = (await query(
    'SELECT id, ticket_no, subject, status, priority, created_at FROM tickets WHERE requester_id = $1 ORDER BY created_at DESC LIMIT 20', [id])).rows;
  res.json({ ...u, assets, licenses, tickets });
}));

router.post('/', requirePerm('employees.manage'), wrap(async (req, res) => {
  const b = req.body;
  if (!b.full_name || !b.email) throw bad('Name and email are required');
  const email = String(b.email).trim().toLowerCase();
  // Only admins can pick a role or set a password; HR-style users create plain employees
  let roleId = int(b.role_id);
  if (!roleId || !req.can('admin.users')) roleId = (await query("SELECT id FROM roles WHERE name = 'Employee'")).rows[0].id;
  const hash = b.password && req.can('admin.users') ? await bcrypt.hash(String(b.password), 10) : null;
  try {
    const { rows } = await query(
      `INSERT INTO users (employee_code, full_name, email, password_hash, role_id, entity_id, department, job_title, phone, location)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [nil(b.employee_code), b.full_name, email, hash, roleId, int(b.entity_id), nil(b.department), nil(b.job_title), nil(b.phone), nil(b.location)]);
    await audit(req.user.id, 'employee.create', 'user', rows[0].id, { email });
    res.status(201).json({ id: rows[0].id });
  } catch (e) {
    if (e.code === '23505') throw bad('An employee with this email or employee code already exists');
    throw e;
  }
}));

router.put('/:id', requirePerm('employees.manage'), wrap(async (req, res) => {
  const id = int(req.params.id);
  const body = { ...req.body };
  if (body.email) body.email = String(body.email).trim().toLowerCase();
  if (id === req.user.id) delete body.is_active;
  const upd = buildUpdate('users', id, body, FIELDS, { updated_at: new Date() });
  if (!upd) throw bad('Nothing to update');
  try {
    const { rows } = await query(upd.text, upd.values);
    if (!rows[0]) throw notFound('Employee');
    await audit(req.user.id, 'employee.update', 'user', id);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23505') throw bad('Email or employee code already in use');
    throw e;
  }
}));

module.exports = router;
