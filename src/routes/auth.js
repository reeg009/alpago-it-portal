const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { query, audit } = require('../db');
const { sign, authenticate } = require('../auth');
const { wrap, bad } = require('../util');

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' } });

router.post('/login', loginLimiter, wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const { rows } = await query('SELECT id, password_hash, is_active, can_login FROM users WHERE email = $1', [email]);
  const u = rows[0];
  if (!u || !u.password_hash || !(await bcrypt.compare(password, u.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (!u.is_active || !u.can_login) return res.status(403).json({ error: 'This account is disabled' });
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [u.id]);
  await audit(u.id, 'login', 'user', u.id);
  res.json({ token: sign(u) });
}));

router.get('/me', authenticate, (req, res) => res.json(req.user));

router.post('/change-password', authenticate, wrap(async (req, res) => {
  const { current, next } = req.body;
  if (!next || String(next).length < 8) throw bad('New password must be at least 8 characters');
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0].password_hash || !(await bcrypt.compare(String(current || ''), rows[0].password_hash))) throw bad('Current password is incorrect');
  await query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [await bcrypt.hash(String(next), 10), req.user.id]);
  await audit(req.user.id, 'password.change', 'user', req.user.id);
  res.json({ ok: true });
}));

module.exports = router;
