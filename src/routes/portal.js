// Dashboard, lookups, employee self-service and reports
const router = require('express').Router();
const { query } = require('../db');
const { requirePerm } = require('../auth');
const { wrap, toCsv } = require('../util');

const pct = (now, before) => (before ? Math.round(((now - before) / before) * 1000) / 10 : now ? 100 : 0);
const one = async (sql, vals) => (await query(sql, vals)).rows[0];

router.get('/dashboard', requirePerm('dashboard.view'), wrap(async (req, res) => {
  const me = req.user.id;
  const all = req.can('tickets.view_all');
  const tScope = all ? 'TRUE' : '(requester_id = $1 OR assignee_id = $1)';
  const tVals = all ? [] : [me];

  const assets = await one(`SELECT COUNT(*) FILTER (WHERE status <> 'Retired')::int AS now,
      COUNT(*) FILTER (WHERE status <> 'Retired' AND created_at < now() - interval '30 days')::int AS before FROM assets`);
  const emps = await one(`SELECT COUNT(*) FILTER (WHERE is_active)::int AS now,
      COUNT(*) FILTER (WHERE is_active AND created_at < now() - interval '30 days')::int AS before FROM users`);
  const lic = await one(`SELECT COUNT(*)::int AS now,
      COUNT(*) FILTER (WHERE assigned_at < now() - interval '30 days')::int AS before FROM license_assignments`);
  const open = await one(`SELECT
      COUNT(*) FILTER (WHERE status NOT IN ('Resolved','Closed','Rejected'))::int AS now,
      COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS last30,
      COUNT(*) FILTER (WHERE created_at >= now() - interval '60 days' AND created_at < now() - interval '30 days')::int AS prev30
    FROM tickets WHERE ${tScope}`, tVals);

  const kpis = {
    assets: { value: assets.now, change: pct(assets.now, assets.before) },
    tickets: { value: open.now, change: pct(open.last30, open.prev30) },
    employees: { value: emps.now, change: pct(emps.now, emps.before) },
    licenses: { value: lic.now, change: pct(lic.now, lic.before) },
  };

  const byPriority = (await query(
    `SELECT priority, COUNT(*)::int AS n FROM tickets
      WHERE status NOT IN ('Resolved','Closed','Rejected') AND ${tScope} GROUP BY priority`, tVals)).rows;
  const byStatus = (await query(
    `SELECT status, COUNT(*)::int AS n FROM tickets WHERE ${tScope} AND status NOT IN ('Closed','Rejected') GROUP BY status`, tVals)).rows;
  const byCategory = (await query(
    `SELECT category, COUNT(*)::int AS n FROM assets WHERE status <> 'Retired' GROUP BY category ORDER BY n DESC`)).rows;

  const myAssets = (await query(
    'SELECT id, asset_tag, name, category, status FROM assets WHERE assigned_to = $1 ORDER BY category, asset_tag', [me])).rows;
  const myTickets = (await query(
    `SELECT id, ticket_no, subject, priority, status, updated_at FROM tickets WHERE requester_id = $1
      ORDER BY updated_at DESC LIMIT 6`, [me])).rows;
  const recent = (await query(
    `SELECT id, ticket_no, subject, priority, status, updated_at FROM tickets WHERE ${tScope}
      ORDER BY updated_at DESC LIMIT 6`, tVals)).rows;

  const alerts = [];
  if (req.can('assets.view')) {
    const w = await one(`SELECT COUNT(*)::int AS n FROM assets WHERE status <> 'Retired' AND warranty_expiry BETWEEN CURRENT_DATE AND CURRENT_DATE + 90`);
    if (w.n) alerts.push({ type: 'warranty', level: 'info', count: w.n, text: `${w.n} assets under warranty expiry`, sub: 'in next 90 days', link: '#/assets?warranty=expiring' });
  }
  if (req.can('licenses.view')) {
    const l = await one(`SELECT COUNT(*)::int AS n FROM licenses WHERE renewal_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30`);
    if (l.n) alerts.push({ type: 'license', level: 'warn', count: l.n, text: `${l.n} software licenses renewing`, sub: 'in next 30 days', link: '#/licenses?renewing=30' });
    const full = await one(`SELECT COUNT(*)::int AS n FROM licenses l WHERE seats_total <= (SELECT COUNT(*) FROM license_assignments la WHERE la.license_id = l.id)`);
    if (full.n) alerts.push({ type: 'seats', level: 'warn', count: full.n, text: `${full.n} licenses at full seat capacity`, sub: 'no free seats', link: '#/licenses' });
  }
  if (req.can('requests.approve') || req.can('tickets.view_all')) {
    const p = await one(`SELECT COUNT(*)::int AS n FROM tickets WHERE status = 'Pending Approval'`);
    if (p.n) alerts.push({ type: 'approval', level: 'info', count: p.n, text: `${p.n} requests pending`, sub: 'approval', link: '#/tickets?status=Pending%20Approval' });
  }
  if (req.can('tickets.view_all')) {
    const s = await one(`SELECT COUNT(*)::int AS n FROM tickets WHERE priority IN ('High','Critical')
      AND status NOT IN ('Resolved','Closed','Rejected','Pending Approval') AND updated_at < now() - interval '4 hours'`);
    if (s.n) alerts.push({ type: 'stale', level: 'danger', count: s.n, text: `${s.n} high-priority tickets unattended`, sub: 'for more than 4 hours', link: '#/tickets?stale=1' });
    const u = await one(`SELECT COUNT(*)::int AS n FROM tickets WHERE assignee_id IS NULL AND status = 'Open'`);
    if (u.n) alerts.push({ type: 'unassigned', level: 'warn', count: u.n, text: `${u.n} open tickets unassigned`, sub: 'need a technician', link: '#/tickets?status=Open&assignee_id=none' });
  }

  res.json({ kpis, byPriority, byStatus, byCategory, myAssets, myTickets, recent, alerts, scope: all ? 'all' : 'mine' });
}));

router.get('/lookups', wrap(async (req, res) => {
  const entities = (await query('SELECT id, name, code, is_active FROM entities ORDER BY id')).rows;
  const technicians = (await query(
    `SELECT DISTINCT u.id, u.full_name FROM users u JOIN role_permissions rp ON rp.role_id = u.role_id
      WHERE rp.permission_key = 'tickets.manage' AND u.is_active ORDER BY u.full_name`)).rows;
  const canPickUsers = ['assets.assign', 'tickets.manage', 'employees.view', 'licenses.manage'].some((p) => req.can(p));
  const users = canPickUsers
    ? (await query('SELECT id, full_name, email, department FROM users WHERE is_active ORDER BY full_name')).rows : [];
  const categories = (await query('SELECT DISTINCT category FROM assets ORDER BY 1')).rows.map((r) => r.category);
  const departments = (await query('SELECT DISTINCT department FROM users WHERE department IS NOT NULL ORDER BY 1')).rows.map((r) => r.department);
  const roles = req.can('admin.users') ? (await query('SELECT id, name FROM roles ORDER BY id')).rows : [];
  res.json({
    entities, technicians, users, roles, departments,
    categories: [...new Set(['Laptop', 'Desktop', 'Monitor', 'Mobile', 'Printer', 'Network', 'Tablet', 'Peripheral', 'Server', ...categories])],
    assetStatuses: ['In Stock', 'Assigned', 'In Use', 'In Repair', 'Retired'],
  });
}));

// ---------- self-service ----------
router.get('/me/overview', wrap(async (req, res) => {
  const me = req.user.id;
  const assets = (await query('SELECT * FROM assets WHERE assigned_to = $1 ORDER BY category, asset_tag', [me])).rows;
  const licenses = (await query(
    `SELECT l.id, l.name, l.vendor, la.assigned_at FROM license_assignments la JOIN licenses l ON l.id = la.license_id
      WHERE la.user_id = $1 ORDER BY l.name`, [me])).rows;
  const tickets = (await query(
    `SELECT t.id, t.ticket_no, t.subject, t.type, t.priority, t.status, t.updated_at, a.full_name AS assignee_name
       FROM tickets t LEFT JOIN users a ON a.id = t.assignee_id WHERE t.requester_id = $1 ORDER BY t.updated_at DESC`, [me])).rows;
  res.json({ assets, licenses, tickets });
}));

// ---------- reports ----------
router.get('/reports', requirePerm('reports.view'), wrap(async (req, res) => {
  const [assetsByEntity, assetsByStatus, ticketsByMonth, resolution, byTech, licenseCost, byType] = await Promise.all([
    query(`SELECT COALESCE(e.name,'Unallocated') AS label, COUNT(*)::int AS n, COALESCE(SUM(a.purchase_cost),0)::float AS value
             FROM assets a LEFT JOIN entities e ON e.id = a.entity_id WHERE a.status <> 'Retired' GROUP BY 1 ORDER BY n DESC`),
    query(`SELECT status AS label, COUNT(*)::int AS n FROM assets GROUP BY 1 ORDER BY n DESC`),
    query(`SELECT to_char(date_trunc('month', created_at), 'Mon YYYY') AS label, date_trunc('month', created_at) AS m,
                  COUNT(*)::int AS opened, COUNT(resolved_at)::int AS resolved
             FROM tickets WHERE created_at > now() - interval '6 months' GROUP BY 1,2 ORDER BY m`),
    query(`SELECT priority AS label, ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600)::numeric, 1)::float AS hours, COUNT(*)::int AS n
             FROM tickets WHERE resolved_at IS NOT NULL AND status <> 'Rejected' GROUP BY 1`),
    query(`SELECT u.full_name AS label, COUNT(*) FILTER (WHERE t.status NOT IN ('Resolved','Closed','Rejected'))::int AS open,
                  COUNT(*) FILTER (WHERE t.status IN ('Resolved','Closed'))::int AS resolved
             FROM tickets t JOIN users u ON u.id = t.assignee_id GROUP BY 1 ORDER BY open DESC`),
    query(`SELECT vendor AS label, SUM(cost)::float AS value, SUM(seats_total)::int AS seats FROM licenses GROUP BY 1 ORDER BY value DESC NULLS LAST`),
    query(`SELECT type AS label, COUNT(*)::int AS n FROM tickets GROUP BY 1 ORDER BY n DESC`),
  ]);
  const data = {
    assetsByEntity: assetsByEntity.rows, assetsByStatus: assetsByStatus.rows, ticketsByMonth: ticketsByMonth.rows,
    resolution: resolution.rows, byTech: byTech.rows, licenseCost: licenseCost.rows, byType: byType.rows,
  };
  if (req.query.format === 'csv' && data[req.query.report]) {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${req.query.report}.csv"`);
    return res.send(toCsv(data[req.query.report]));
  }
  res.json(data);
}));

module.exports = router;
