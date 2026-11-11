const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { query, tx, audit } = require('../db');
const { requirePerm } = require('../auth');
const { wrap, bad, notFound, nil, int, paging } = require('../util');

// ---------- Entities ----------
router.get('/entities', requirePerm('admin.entities'), wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT e.*, (SELECT COUNT(*)::int FROM users u WHERE u.entity_id = e.id AND u.is_active) AS employees,
            (SELECT COUNT(*)::int FROM assets a WHERE a.entity_id = e.id AND a.status <> 'Retired') AS assets
       FROM entities e ORDER BY e.id`);
  res.json({ rows });
}));

router.post('/entities', requirePerm('admin.entities'), wrap(async (req, res) => {
  const { name, code } = req.body;
  if (!name || !code) throw bad('Name and code are required');
  try {
    const { rows } = await query('INSERT INTO entities (name, code) VALUES ($1,$2) RETURNING *', [name.trim(), code.trim().toUpperCase()]);
    await audit(req.user.id, 'entity.create', 'entity', rows[0].id, { name });
    res.status(201).json(rows[0]);
  } catch (e) { if (e.code === '23505') throw bad('Entity name or code already exists'); throw e; }
}));

router.put('/entities/:id', requirePerm('admin.entities'), wrap(async (req, res) => {
  const id = int(req.params.id);
  const b = req.body;
  try {
    const { rows } = await query(
      `UPDATE entities SET name = COALESCE($2, name), code = COALESCE($3, code), is_active = COALESCE($4, is_active)
        WHERE id = $1 RETURNING *`, [id, nil(b.name), b.code ? b.code.toUpperCase() : null, b.is_active ?? null]);
    if (!rows[0]) throw notFound('Entity');
    await audit(req.user.id, 'entity.update', 'entity', id, b);
    res.json(rows[0]);
  } catch (e) { if (e.code === '23505') throw bad('Entity name or code already exists'); throw e; }
}));

router.delete('/entities/:id', requirePerm('admin.entities'), wrap(async (req, res) => {
  const id = int(req.params.id);
  const used = (await query(
    `SELECT (SELECT COUNT(*) FROM users WHERE entity_id = $1) + (SELECT COUNT(*) FROM assets WHERE entity_id = $1) AS n`, [id])).rows[0].n;
  if (Number(used) > 0) throw bad('Entity still has employees or assets — deactivate it instead');
  await query('DELETE FROM entities WHERE id = $1', [id]);
  await audit(req.user.id, 'entity.delete', 'entity', id);
  res.json({ ok: true });
}));

// ---------- Roles & permissions ----------
router.get('/permissions', requirePerm('admin.roles', 'admin.users'), wrap(async (req, res) => {
  res.json({ rows: (await query('SELECT * FROM permissions ORDER BY module, key')).rows });
}));

router.get('/roles', requirePerm('admin.roles', 'admin.users'), wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT r.*, COALESCE(array_agg(rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS permissions,
            (SELECT COUNT(*)::int FROM users u WHERE u.role_id = r.id) AS user_count
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id GROUP BY r.id ORDER BY r.id`);
  res.json({ rows });
}));

async function setPerms(c, roleId, perms) {
  const valid = (await c.query('SELECT key FROM permissions')).rows.map((r) => r.key);
  await c.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
  for (const p of (perms || []).filter((x) => valid.includes(x))) {
    await c.query('INSERT INTO role_permissions VALUES ($1,$2)', [roleId, p]);
  }
}

router.post('/roles', requirePerm('admin.roles'), wrap(async (req, res) => {
  const { name, description, permissions } = req.body;
  if (!name) throw bad('Role name is required');
  try {
    const role = await tx(async (c) => {
      const { rows } = await c.query('INSERT INTO roles (name, description) VALUES ($1,$2) RETURNING *', [name.trim(), nil(description)]);
      await setPerms(c, rows[0].id, permissions);
      return rows[0];
    });
    await audit(req.user.id, 'role.create', 'role', role.id, { name, permissions });
    res.status(201).json(role);
  } catch (e) { if (e.code === '23505') throw bad('A role with this name exists'); throw e; }
}));

router.put('/roles/:id', requirePerm('admin.roles'), wrap(async (req, res) => {
  const id = int(req.params.id);
  const role = (await query('SELECT * FROM roles WHERE id = $1', [id])).rows[0];
  if (!role) throw notFound('Role');
  const { name, description, permissions } = req.body;
  await tx(async (c) => {
    await c.query('UPDATE roles SET name = COALESCE($2, name), description = COALESCE($3, description) WHERE id = $1',
      [id, role.is_system ? null : nil(name), nil(description)]);
    // the Administrator role always keeps full access so nobody can lock themselves out
    if (Array.isArray(permissions) && !role.is_system) await setPerms(c, id, permissions);
  });
  await audit(req.user.id, 'role.update', 'role', id, { permissions });
  res.json({ ok: true });
}));

router.delete('/roles/:id', requirePerm('admin.roles'), wrap(async (req, res) => {
  const id = int(req.params.id);
  const role = (await query('SELECT * FROM roles WHERE id = $1', [id])).rows[0];
  if (!role) throw notFound('Role');
  if (role.is_system) throw bad('The Administrator role cannot be deleted');
  const n = (await query('SELECT COUNT(*)::int AS n FROM users WHERE role_id = $1', [id])).rows[0].n;
  if (n) throw bad(`Move the ${n} user(s) with this role first`);
  await query('DELETE FROM roles WHERE id = $1', [id]);
  await audit(req.user.id, 'role.delete', 'role', id, { name: role.name });
  res.json({ ok: true });
}));

// ---------- User accounts ----------
router.get('/users', requirePerm('admin.users'), wrap(async (req, res) => {
  const { page, pageSize, offset } = paging(req);
  const vals = [];
  let where = '';
  if (req.query.q) { vals.push(`%${req.query.q}%`); where = 'WHERE (u.full_name ILIKE $1 OR u.email ILIKE $1)'; }
  if (req.query.role_id) { vals.push(int(req.query.role_id)); where += `${where ? ' AND' : 'WHERE'} u.role_id = $${vals.length}`; }
  const total = (await query(`SELECT COUNT(*)::int AS n FROM users u ${where}`, vals)).rows[0].n;
  const { rows } = await query(
    `SELECT u.id, u.full_name, u.email, u.role_id, r.name AS role_name, e.name AS entity_name, u.is_active, u.can_login,
            (u.password_hash IS NOT NULL) AS has_password, u.last_login_at
       FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN entities e ON e.id = u.entity_id
       ${where} ORDER BY r.id, u.full_name LIMIT ${pageSize} OFFSET ${offset}`, vals);
  res.json({ rows, total, page, pageSize });
}));

async function adminCount(excludeId) {
  return (await query(
    `SELECT COUNT(*)::int AS n FROM users u JOIN roles r ON r.id = u.role_id
      WHERE r.is_system AND u.is_active AND u.can_login AND u.id <> $1`, [excludeId])).rows[0].n;
}

router.put('/users/:id', requirePerm('admin.users'), wrap(async (req, res) => {
  const id = int(req.params.id);
  const u = (await query('SELECT u.*, r.is_system FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1', [id])).rows[0];
  if (!u) throw notFound('User');
  const b = req.body;
  if (u.is_system) {
    const losingAdmin = (b.role_id && int(b.role_id) !== u.role_id) || b.is_active === false || b.can_login === false;
    if (losingAdmin && (await adminCount(id)) === 0) throw bad('At least one active Administrator is required');
  }
  await query(
    `UPDATE users SET role_id = COALESCE($2, role_id), is_active = COALESCE($3, is_active), can_login = COALESCE($4, can_login),
            updated_at = now() WHERE id = $1`, [id, int(b.role_id), b.is_active ?? null, b.can_login ?? null]);
  await audit(req.user.id, 'user.update', 'user', id, b);
  res.json({ ok: true });
}));

router.post('/users/:id/password', requirePerm('admin.users'), wrap(async (req, res) => {
  const id = int(req.params.id);
  const pw = String(req.body.password || '');
  if (pw.length < 8) throw bad('Password must be at least 8 characters');
  const { rowCount } = await query('UPDATE users SET password_hash = $2, can_login = TRUE, updated_at = now() WHERE id = $1',
    [id, await bcrypt.hash(pw, 10)]);
  if (!rowCount) throw notFound('User');
  await audit(req.user.id, 'user.password_reset', 'user', id);
  res.json({ ok: true });
}));

// ---------- Audit ----------
router.get('/audit', requirePerm('admin.audit'), wrap(async (req, res) => {
  const { page, pageSize, offset } = paging(req);
  const total = (await query('SELECT COUNT(*)::int AS n FROM audit_log')).rows[0].n;
  const { rows } = await query(
    `SELECT l.*, u.full_name FROM audit_log l LEFT JOIN users u ON u.id = l.user_id
      ORDER BY l.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`);
  res.json({ rows, total, page, pageSize });
}));

module.exports = router;
