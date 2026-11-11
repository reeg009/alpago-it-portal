require('./env');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { query, tx } = require('./db');
const { PERMISSIONS, DEFAULT_ROLES } = require('./permissions');

const ENTITIES = [
  ['Alpago Group', 'AGR'],
  ['Alpago Design and Build', 'ADB'],
  ['Alpago Properties', 'APR'],
  ['Alpago Facility MGT', 'AFM'],
  ['Alpago Manufacturing', 'AMF'],
];

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await query(sql);

  // permissions: upsert so new keys added in code appear automatically
  for (const [key, module, description] of PERMISSIONS) {
    await query(
      `INSERT INTO permissions (key, module, description) VALUES ($1,$2,$3)
       ON CONFLICT (key) DO UPDATE SET module = EXCLUDED.module, description = EXCLUDED.description`,
      [key, module, description]
    );
  }

  const { rows: roleCount } = await query('SELECT COUNT(*)::int AS n FROM roles');
  if (roleCount[0].n === 0) {
    for (const [name, def] of Object.entries(DEFAULT_ROLES)) {
      const { rows } = await query(
        'INSERT INTO roles (name, description, is_system) VALUES ($1,$2,$3) RETURNING id',
        [name, def.description, name === 'Administrator']
      );
      for (const p of def.perms) {
        await query('INSERT INTO role_permissions VALUES ($1,$2) ON CONFLICT DO NOTHING', [rows[0].id, p]);
      }
    }
  }
  // Administrator always has every permission
  await query(
    `INSERT INTO role_permissions (role_id, permission_key)
     SELECT r.id, p.key FROM roles r CROSS JOIN permissions p WHERE r.name = 'Administrator'
     ON CONFLICT DO NOTHING`
  );

  const { rows: entCount } = await query('SELECT COUNT(*)::int AS n FROM entities');
  if (entCount[0].n === 0) {
    for (const [name, code] of ENTITIES) {
      await query('INSERT INTO entities (name, code) VALUES ($1,$2)', [name, code]);
    }
  }

  // bootstrap admin
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@alpago.local').toLowerCase();
  const { rows: existing } = await query('SELECT id FROM users WHERE email = $1', [adminEmail]);
  if (!existing.length) {
    const pw = process.env.ADMIN_PASSWORD || 'ChangeMe!2026';
    const { rows: r } = await query("SELECT id FROM roles WHERE name = 'Administrator'");
    const { rows: e } = await query("SELECT id FROM entities WHERE code = 'AGR'");
    await query(
      `INSERT INTO users (employee_code, full_name, email, password_hash, role_id, entity_id, department, job_title)
       VALUES ('EMP-0001', $1, $2, $3, $4, $5, 'IT & Innovation', 'IT Manager')`,
      [process.env.ADMIN_NAME || 'Portal Administrator', adminEmail, await bcrypt.hash(pw, 10), r[0].id, e[0]?.id || null]
    );
    console.log(`Created admin account ${adminEmail}`);
  }

  // One-time data reset: runs once per DATA_RESET_TOKEN value.
  // Keeps Administrator accounts, entities, roles and permissions; deletes everything else.
  const resetToken = process.env.DATA_RESET_TOKEN;
  if (resetToken) {
    await query('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT, created_at TIMESTAMPTZ DEFAULT now())');
    const done = (await query('SELECT 1 FROM app_meta WHERE key = $1', [`reset:${resetToken}`])).rows[0];
    if (!done) {
      await tx(async (c) => {
        await c.query('DELETE FROM license_assignments');
        await c.query('DELETE FROM licenses');
        await c.query('DELETE FROM ticket_comments');
        await c.query('DELETE FROM tickets');
        await c.query('DELETE FROM asset_history');
        await c.query('DELETE FROM assets');
        await c.query('DELETE FROM audit_log');
        await c.query(`DELETE FROM users WHERE role_id NOT IN (SELECT id FROM roles WHERE is_system)`);
        await c.query("ALTER SEQUENCE ticket_no_seq RESTART WITH 1");
        await c.query('INSERT INTO app_meta (key, value) VALUES ($1, $2)', [`reset:${resetToken}`, 'done']);
      });
      console.log(`Data reset completed (token ${resetToken})`);
    }
  }

  if (process.env.SEED_DEMO === 'true') {
    const { rows } = await query('SELECT COUNT(*)::int AS n FROM assets');
    if (rows[0].n === 0) await require('./demo-seed')(tx);
  }
}

module.exports = migrate;

if (require.main === module) {
  migrate()
    .then(() => { console.log('Migration complete'); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
