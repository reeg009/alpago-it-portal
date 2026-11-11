const router = require('express').Router();
const { query, tx, audit } = require('../db');
const { requirePerm } = require('../auth');
const { wrap, bad, notFound, forbidden, nil, int, toCsv, paging } = require('../util');

const STATUSES = ['Pending Approval', 'Open', 'Assigned', 'In Progress', 'Pending', 'Resolved', 'Closed', 'Rejected'];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
const TYPES = ['Incident', 'Service Request', 'Asset Request', 'Software Request', 'Onboarding', 'Asset Transfer'];
const NEEDS_APPROVAL = ['Asset Request', 'Software Request', 'Onboarding', 'Asset Transfer'];
const CLOSED = ['Resolved', 'Closed', 'Rejected'];

const BASE = `
  FROM tickets t
  LEFT JOIN users r ON r.id = t.requester_id
  LEFT JOIN users a ON a.id = t.assignee_id
  LEFT JOIN entities e ON e.id = t.entity_id
  LEFT JOIN assets s ON s.id = t.asset_id`;
const COLS = `t.*, r.full_name AS requester_name, r.email AS requester_email, a.full_name AS assignee_name,
              e.name AS entity_name, s.asset_tag, s.name AS asset_name`;

function scope(req, where, vals) {
  if (req.can('tickets.view_all')) return;
  if (req.can('requests.approve')) {
    vals.push(req.user.id);
    where.push(`(t.requester_id = $${vals.length} OR t.assignee_id = $${vals.length} OR t.status = 'Pending Approval')`);
    return;
  }
  vals.push(req.user.id);
  where.push(`(t.requester_id = $${vals.length} OR t.assignee_id = $${vals.length})`);
}

function filters(req) {
  const q = req.query;
  const where = [];
  const vals = [];
  scope(req, where, vals);
  const add = (sql, v) => { vals.push(v); where.push(sql.replace('?', `$${vals.length}`)); };
  if (q.q) {
    vals.push(`%${q.q}%`);
    const p = `$${vals.length}`;
    where.push(`(t.ticket_no ILIKE ${p} OR t.subject ILIKE ${p} OR r.full_name ILIKE ${p})`);
  }
  if (q.status === 'open') where.push(`t.status NOT IN ('Resolved','Closed','Rejected')`);
  else if (q.status) add('t.status = ?', q.status);
  if (q.priority) add('t.priority = ?', q.priority);
  if (q.type) add('t.type = ?', q.type);
  if (q.entity_id) add('t.entity_id = ?', int(q.entity_id));
  if (q.assignee_id === 'none') where.push('t.assignee_id IS NULL');
  else if (q.assignee_id) add('t.assignee_id = ?', int(q.assignee_id));
  if (q.mine === 'requested') add('t.requester_id = ?', req.user.id);
  if (q.mine === 'assigned') add('t.assignee_id = ?', req.user.id);
  if (q.stale === '1') where.push(`t.priority IN ('High','Critical') AND t.status NOT IN ('Resolved','Closed','Rejected','Pending Approval') AND t.updated_at < now() - interval '4 hours'`);
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', vals };
}

async function getTicket(req, id) {
  const { rows } = await query(`SELECT ${COLS} ${BASE} WHERE t.id = $1`, [id]);
  const t = rows[0];
  if (!t) throw notFound('Ticket');
  const allowed = req.can('tickets.view_all') || t.requester_id === req.user.id || t.assignee_id === req.user.id
    || (req.can('requests.approve') && t.status === 'Pending Approval');
  if (!allowed) throw notFound('Ticket');
  return t;
}

const sysComment = (c, ticketId, userId, body) =>
  c.query('INSERT INTO ticket_comments (ticket_id, user_id, body, is_system) VALUES ($1,$2,$3,TRUE)', [ticketId, userId, body]);

router.get('/meta', (req, res) => res.json({ STATUSES, PRIORITIES, TYPES, NEEDS_APPROVAL }));

router.get('/', wrap(async (req, res) => {
  const { where, vals } = filters(req);
  const { page, pageSize, offset } = paging(req);
  const total = (await query(`SELECT COUNT(*)::int AS n ${BASE} ${where}`, vals)).rows[0].n;
  const { rows } = await query(
    `SELECT ${COLS} ${BASE} ${where}
     ORDER BY CASE WHEN t.status IN ('Resolved','Closed','Rejected') THEN 1 ELSE 0 END,
              t.updated_at DESC LIMIT ${pageSize} OFFSET ${offset}`, vals);
  res.json({ rows, total, page, pageSize });
}));

router.get('/export.csv', requirePerm('tickets.view_all'), wrap(async (req, res) => {
  const { where, vals } = filters(req);
  const { rows } = await query(
    `SELECT t.ticket_no, t.subject, t.type, t.category, t.priority, t.status, r.full_name AS requester, a.full_name AS assignee,
            e.name AS entity, s.asset_tag, t.created_at, t.updated_at, t.resolved_at ${BASE} ${where} ORDER BY t.created_at DESC`, vals);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="alpago-tickets.csv"');
  res.send(toCsv(rows));
}));

router.get('/:id', wrap(async (req, res) => {
  const t = await getTicket(req, int(req.params.id));
  const internal = req.can('tickets.internal_notes');
  const comments = (await query(
    `SELECT c.*, u.full_name AS author_name FROM ticket_comments c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.ticket_id = $1 ${internal ? '' : 'AND NOT c.is_internal'} ORDER BY c.created_at, c.id`, [t.id])).rows;
  res.json({ ...t, comments });
}));

router.post('/', wrap(async (req, res) => {
  const b = req.body;
  if (!b.subject || !String(b.subject).trim()) throw bad('Subject is required');
  const type = TYPES.includes(b.type) ? b.type : 'Incident';
  const priority = PRIORITIES.includes(b.priority) ? b.priority : 'Medium';
  // Staff may raise a ticket on behalf of someone else
  const requester = req.can('tickets.manage') && int(b.requester_id) ? int(b.requester_id) : req.user.id;
  let assetId = int(b.asset_id);
  if (assetId && !req.can('assets.view')) {
    const own = (await query('SELECT 1 FROM assets WHERE id = $1 AND assigned_to = $2', [assetId, req.user.id])).rows[0];
    if (!own) assetId = null;
  }
  const status = NEEDS_APPROVAL.includes(type) ? 'Pending Approval' : 'Open';
  const t = await tx(async (c) => {
    const no = (await c.query("SELECT nextval('ticket_no_seq') AS n")).rows[0].n;
    const ent = int(b.entity_id) || (await c.query('SELECT entity_id FROM users WHERE id = $1', [requester])).rows[0]?.entity_id;
    const { rows } = await c.query(
      `INSERT INTO tickets (ticket_no, subject, description, type, category, priority, status, requester_id, entity_id, asset_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [`IT-${new Date().getFullYear()}-${String(no).padStart(4, '0')}`, String(b.subject).trim(), nil(b.description), type,
       nil(b.category), priority, status, requester, ent || null, assetId]);
    await sysComment(c, rows[0].id, req.user.id,
      status === 'Pending Approval' ? `${type} submitted — awaiting manager approval` : 'Ticket created');
    return rows[0];
  });
  await audit(req.user.id, 'ticket.create', 'ticket', t.id, { ticket_no: t.ticket_no });
  res.status(201).json(t);
}));

// Assign technician / change status / priority / category
router.patch('/:id', wrap(async (req, res) => {
  const id = int(req.params.id);
  const t = await getTicket(req, id);
  const b = req.body;
  const isManager = req.can('tickets.manage');
  const isRequester = t.requester_id === req.user.id;

  // requesters may only close their own resolved ticket or reopen it
  if (!isManager) {
    const allowed = isRequester && Object.keys(b).every((k) => k === 'status') &&
      ((b.status === 'Closed' && t.status === 'Resolved') || (b.status === 'Open' && ['Resolved', 'Closed'].includes(t.status)));
    if (!allowed) throw forbidden();
  }
  if (t.status === 'Pending Approval' && b.status && b.status !== 'Pending Approval') {
    throw bad('This request must be approved or rejected first');
  }

  const changes = [];
  await tx(async (c) => {
    const sets = ['updated_at = now()'];
    const vals = [];
    const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };

    if (b.assignee_id !== undefined) {
      const aid = int(b.assignee_id);
      if (aid !== t.assignee_id) {
        let name = 'Unassigned';
        if (aid) {
          const tech = (await c.query(
            `SELECT u.full_name FROM users u JOIN role_permissions rp ON rp.role_id = u.role_id
              WHERE u.id = $1 AND u.is_active AND rp.permission_key = 'tickets.manage'`, [aid])).rows[0];
          if (!tech) throw bad('Selected user is not a technician');
          name = tech.full_name;
        }
        set('assignee_id', aid);
        changes.push(`Assigned to ${name}`);
        if (aid && t.status === 'Open' && !b.status) { set('status', 'Assigned'); changes.push('Status → Assigned'); }
      }
    }
    if (b.status && b.status !== t.status) {
      if (!STATUSES.includes(b.status) || ['Pending Approval', 'Rejected'].includes(b.status)) throw bad('Invalid status');
      set('status', b.status);
      changes.push(`Status → ${b.status}`);
      if (CLOSED.includes(b.status) && !t.resolved_at) sets.push('resolved_at = now()');
      if (!CLOSED.includes(b.status)) sets.push('resolved_at = NULL');
    }
    if (b.priority && b.priority !== t.priority) {
      if (!PRIORITIES.includes(b.priority)) throw bad('Invalid priority');
      set('priority', b.priority);
      changes.push(`Priority → ${b.priority}`);
    }
    if (b.category !== undefined && nil(b.category) !== t.category) { set('category', nil(b.category)); changes.push(`Category → ${b.category || 'none'}`); }
    if (b.asset_id !== undefined && int(b.asset_id) !== t.asset_id) { set('asset_id', int(b.asset_id)); changes.push('Linked asset updated'); }
    if (!changes.length) return;
    vals.push(id);
    await c.query(`UPDATE tickets SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    await sysComment(c, id, req.user.id, changes.join(' · '));
  });
  if (changes.length) await audit(req.user.id, 'ticket.update', 'ticket', id, { changes });
  res.json({ ok: true, changes });
}));

router.post('/:id/comments', wrap(async (req, res) => {
  const id = int(req.params.id);
  const t = await getTicket(req, id);
  const body = String(req.body.body || '').trim();
  if (!body) throw bad('Comment cannot be empty');
  const internal = !!req.body.is_internal && req.can('tickets.internal_notes');
  const { rows } = await query(
    'INSERT INTO ticket_comments (ticket_id, user_id, body, is_internal) VALUES ($1,$2,$3,$4) RETURNING *',
    [t.id, req.user.id, body, internal]);
  // a requester reply on a "Pending" ticket puts it back in the queue
  const reopen = t.requester_id === req.user.id && t.status === 'Pending';
  await query(`UPDATE tickets SET updated_at = now() ${reopen ? ", status = 'In Progress'" : ''} WHERE id = $1`, [t.id]);
  res.status(201).json(rows[0]);
}));

async function decide(req, res, approve) {
  const id = int(req.params.id);
  const t = await getTicket(req, id);
  if (t.status !== 'Pending Approval') throw bad('This request is not awaiting approval');
  if (t.requester_id === req.user.id && !req.can('admin.roles')) throw bad('You cannot approve your own request');
  await tx(async (c) => {
    await c.query(
      `UPDATE tickets SET status = $2, approved_by = $3, approved_at = now(), updated_at = now(),
              resolved_at = CASE WHEN $2 = 'Rejected' THEN now() ELSE NULL END WHERE id = $1`,
      [id, approve ? 'Open' : 'Rejected', req.user.id]);
    const note = nil(req.body.note);
    await sysComment(c, id, req.user.id, `${approve ? 'Approved' : 'Rejected'} by ${req.user.full_name}${note ? ` — ${note}` : ''}`);
  });
  await audit(req.user.id, approve ? 'ticket.approve' : 'ticket.reject', 'ticket', id);
  res.json({ ok: true });
}
router.post('/:id/approve', requirePerm('requests.approve'), wrap((req, res) => decide(req, res, true)));
router.post('/:id/reject', requirePerm('requests.approve'), wrap((req, res) => decide(req, res, false)));

module.exports = router;
module.exports.CLOSED = CLOSED;
