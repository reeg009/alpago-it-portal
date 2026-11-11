const jwt = require('jsonwebtoken');
const { query } = require('./db');

const SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('JWT_SECRET must be set in production');
  process.exit(1);
}

function sign(user) {
  return jwt.sign({ uid: user.id }, SECRET, { expiresIn: process.env.JWT_EXPIRES || '12h' });
}

async function loadUser(id) {
  const { rows } = await query(
    `SELECT u.id, u.full_name, u.email, u.role_id, r.name AS role_name, u.entity_id, e.name AS entity_name,
            u.department, u.job_title, u.is_active, u.can_login,
            COALESCE(array_agg(rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS permissions
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN entities e ON e.id = u.entity_id
       LEFT JOIN role_permissions rp ON rp.role_id = u.role_id
      WHERE u.id = $1
      GROUP BY u.id, r.name, e.name`,
    [id]
  );
  return rows[0];
}

async function authenticate(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { uid } = jwt.verify(token, SECRET);
    const user = await loadUser(uid);
    if (!user || !user.is_active || !user.can_login) return res.status(401).json({ error: 'Account disabled' });
    req.user = user;
    req.can = (p) => user.permissions.includes(p);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired' });
  }
}

const requirePerm = (...perms) => (req, res, next) => {
  if (perms.some((p) => req.can(p))) return next();
  return res.status(403).json({ error: 'You do not have permission for this action' });
};

module.exports = { sign, authenticate, requirePerm, loadUser };
