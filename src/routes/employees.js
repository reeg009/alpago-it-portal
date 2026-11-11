const express = require('express');
const router = express.Router();
const { runImport } = require('../hr-import');
const bcrypt = require('bcryptjs');
const { query, audit } = require('../db');
const { requirePerm } = require('../auth');
const { wrap, bad, notFound, nil, int, buildUpdate, toCsv, paging } = require('../util');

const FIELDS = ['employee_code', 'full_name', 'email', 'entity_id', 'department', 'job_title', 'phone', 'location', 'is_active',
  'reporting_manager_id', 'visa_sponsor', 'grade', 'nationality', 'gender', 'date_of_birth', 'date_of_joining', 'probation_days',
  'probation_end_date', 'probation_status', 'employment_status', 'resign_type', 'resign_date', 'relieve_date', 'phone_personal',
  'phone_extension', 'is_manager', 'weekly_off1', 'weekly_off2', 'shift_start', 'shift_end'];

const BASE = `FROM users u LEFT JOIN entities e ON e.id = u.entity_id JOIN roles r ON r.id = u.role_id
  LEFT JOIN users m ON m.id = u.reporting_manager_id`;
const COLS = `u.id, u.employee_code, u.full_name, u.email, u.entity_id, e.name AS entity_name, u.department, u.job_title,
              u.phone, u.location, u.is_active, u.can_login, u.role_id, r.name AS role_name, u.last_login_at, u.created_at,
              u.reporting_manager_id, COALESCE(m.full_name, u.reporting_manager_name) AS reporting_manager, u.visa_sponsor, u.grade,
              u.nationality, u.gender, u.date_of_birth, u.date_of_joining, u.probation_days, u.probation_end_date, u.probation_status,
              u.employment_status, u.resign_type, u.resign_date, u.relieve_date, u.phone_personal, u.phone_extension, u.is_manager,
              u.weekly_off1, u.weekly_off2, u.shift_start, u.shift_end, u.ess_created, u.ess_user_id, u.hr_synced_at,
              (SELECT COUNT(*)::int FROM assets a WHERE a.assigned_to = u.id) AS asset_count`;

function filters(q) {
  const where = [];
  const vals = [];
  if (q.q) {
    vals.push(`%${q.q}%`);
    where.push(`(u.full_name ILIKE $${vals.length} OR u.email ILIKE $${vals.length} OR u.employee_code ILIKE $${vals.length} OR u.department ILIKE $${vals.length} OR u.job_title ILIKE $${vals.length})`);
  }
  if (q.entity_id) { vals.push(int(q.entity_id)); where.push(`u.entity_id = $${vals.length}`); }
  if (q.department) { vals.push(q.department); where.push(`u.department = $${vals.length}`); }
  if (q.manager_id) { vals.push(int(q.manager_id)); where.push(`u.reporting_manager_id = $${vals.length}`); }
  if (q.probation === 'under') where.push("u.probation_status ILIKE 'under%'");
  if (q.leaving === 'true') where.push('u.relieve_date IS NOT NULL AND u.relieve_date >= CURRENT_DATE');
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
    `SELECT u.employee_code, u.full_name, u.email, e.name AS entity, u.department, u.job_title,
            COALESCE(m.full_name, u.reporting_manager_name) AS reporting_manager, u.visa_sponsor, u.grade, u.nationality, u.gender,
            u.date_of_joining, u.probation_status, u.probation_end_date, u.employment_status, u.resign_type, u.resign_date,
            u.relieve_date, u.phone AS phone_office, u.phone_personal, u.phone_extension, u.is_manager, u.weekly_off1, u.weekly_off2,
            u.shift_start, u.shift_end, u.location, r.name AS portal_role, u.is_active ${BASE} ${where} ORDER BY u.full_name`, vals);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="alpago-employees.csv"');
  res.send(toCsv(rows));
}));

// HR Employee Master import (.xlsx). ?commit=1 writes; otherwise a dry-run preview.
router.post('/import', requirePerm('employees.manage'),
  express.raw({ type: () => true, limit: '15mb' }),
  wrap(async (req, res) => {
    if (!req.body || !req.body.length) throw bad('Upload the Employee Master .xlsx file');
    const report = await runImport(req.body, { commit: req.query.commit === '1', userId: req.user.id });
    res.json(report);
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
  const reports = (await query(
    'SELECT id, full_name, job_title, is_active FROM users WHERE reporting_manager_id = $1 ORDER BY is_active DESC, full_name', [id])).rows;
  const lines = (await query(
    `SELECT id, provider, list, account, product_category, package, designation FROM isp_lines
      WHERE employee_id = $1 ORDER BY list, sort_order`, [id])).rows;
  res.json({ ...u, assets, licenses, tickets, reports, lines });
}));

router.post('/', requirePerm('employees.manage'), wrap(async (req, res) => {
  const b = req.body;
  if (!b.full_name) throw bad('Name is required');
  const email = b.email ? String(b.email).trim().toLowerCase() : null;
  // Only admins can pick a role or set a password; HR-style users create plain employees
  let roleId = int(b.role_id);
  if (!roleId || !req.can('admin.users')) roleId = (await query("SELECT id FROM roles WHERE name = 'Employee'")).rows[0].id;
  if (b.password && !email) throw bad('An email is required to give this person a sign-in');
  const hash = b.password && req.can('admin.users') ? await bcrypt.hash(String(b.password), 10) : null;
  const extra = FIELDS.filter((f) => !['employee_code', 'full_name', 'email', 'is_active'].includes(f) && b[f] !== undefined && b[f] !== '');
  try {
    const cols = ['employee_code', 'full_name', 'email', 'password_hash', 'role_id', ...extra];
    const vals = [nil(b.employee_code), String(b.full_name).trim(), email, hash, roleId, ...extra.map((f) => nil(b[f]))];
    const { rows } = await query(
      `INSERT INTO users (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, vals);
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
  if (body.email !== undefined) body.email = body.email ? String(body.email).trim().toLowerCase() : null;
  if (body.is_manager !== undefined) body.is_manager = !!body.is_manager;
  if (int(body.reporting_manager_id) === id) throw bad('An employee cannot report to themselves');
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
