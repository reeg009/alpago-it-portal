// Import the HR "Employee Master Detailed Report" (.xlsx) into users.
// Only master fields are read. Identity documents (Emirates ID, passport, visa, labour card, MOL)
// and payroll/bank columns are never read or stored.
const ExcelJS = require('exceljs');
const { pool } = require('./db');

// header text (normalised) -> field
const MAP = {
  'emp code': 'employee_code',
  'employe name': 'full_name', 'employee name': 'full_name',
  'reporting manager': 'reporting_manager_name',
  location: 'location_entity',
  visa: 'visa_sponsor',
  department: 'department',
  designation: 'job_title',
  grade: 'grade',
  nationality: 'nationality',
  gender: 'gender',
  status: 'employment_status',
  'date of joining': 'date_of_joining',
  'date of birth': 'date_of_birth',
  'probation days': 'probation_days',
  'probation end date': 'probation_end_date',
  'probation status': 'probation_status',
  'resign date': 'resign_date',
  'relieve date': 'relieve_date',
  'resign type': 'resign_type',
  email: 'email',
  'contact no office': 'phone',
  'contact no personal': 'phone_personal', 'contact no persona': 'phone_personal',
  'contact office extension': 'phone_extension', 'contact office ext': 'phone_extension',
  ismanager: 'is_manager',
  'weekly off1': 'weekly_off1',
  'weekly off2': 'weekly_off2',
  checkin: 'shift_start',
  checkout: 'shift_end',
  'ess created': 'ess_created',
  'ess user id': 'ess_user_id',
};
const SKIPPED_GROUPS = 'Emirates ID, passport, visa number/dates, labour card, MOL, bank, IBAN, payment mode';

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const key = (s) => norm(s).toLowerCase();
const nameKey = (s) => norm(s).toUpperCase().replace(/[^A-Z ]/g, '').replace(/\s+/g, ' ').trim();

function cellValue(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellValue(v.result);
    if ('text' in v) return v.text;
    if (v.error) return null;
  }
  return v;
}
const str = (v) => { const s = norm(v instanceof Date ? v.toISOString() : v); return s === '' ? null : s; };
const date = (v) => (v instanceof Date && !isNaN(v) ? v.toISOString().slice(0, 10) : null);
const time = (v) => (v instanceof Date && !isNaN(v) ? v.toISOString().slice(11, 16) : str(v));
const int = (v) => { const n = parseInt(String(v ?? '').replace(/,/g, ''), 10); return isNaN(n) ? null : n; };
const yes = (v) => (v === null || v === undefined || v === '' ? null : /^(yes|y|true|1)$/i.test(String(v).trim()));
const titleCase = (s) => (s ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s);

function entityCode(loc) {
  const l = (loc || '').toLowerCase();
  if (l.includes('design') || l.includes('contracting')) return 'ADB';
  if (l.includes('manufactur')) return 'AMF';
  if (l.includes('facilit')) return 'AFM';
  if (l.includes('propert')) return 'APR';
  if (l.includes('group')) return 'AGR';
  return null;
}

async function parse(buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch {
    throw Object.assign(new Error('That file could not be read as an Excel (.xlsx) workbook'), { status: 400 });
  }
  const ws = wb.worksheets[0];
  if (!ws) throw Object.assign(new Error('The workbook has no sheets'), { status: 400 });
  // find header row: the first row containing "Emp Code"
  let headerRow = null;
  ws.eachRow((row, n) => {
    if (headerRow) return;
    if (row.values.some((v) => key(cellValue(v)) === 'emp code')) headerRow = n;
  });
  if (!headerRow) throw Object.assign(new Error('Could not find the "Emp Code" header — is this the Employee Master report?'), { status: 400 });
  const cols = {};
  ws.getRow(headerRow).values.forEach((v, i) => { const f = MAP[key(cellValue(v))]; if (f && !cols[f]) cols[f] = i; });
  if (!cols.employee_code || !cols.full_name) throw Object.assign(new Error('Missing "Emp Code" or "Employe Name" column'), { status: 400 });

  const rows = [];
  const badEmails = [];
  for (let n = headerRow + 1; n <= ws.rowCount; n++) {
    const r = ws.getRow(n);
    const g = (f) => (cols[f] ? cellValue(r.getCell(cols[f]).value) : null);
    const code = int(g('employee_code'));
    const name = str(g('full_name'));
    if (!code || !name) continue;
    const rawEmail = str(g('email'));
    const email = rawEmail ? (rawEmail.toLowerCase().match(/[^@\s]+@[^@\s]+\.[^@\s]+/) || [null])[0] : null;
    if (rawEmail && !email && /[a-z0-9]/i.test(rawEmail)) badEmails.push(name.toUpperCase());
    rows.push({
      employee_code: String(code),
      full_name: name.toUpperCase(),
      reporting_manager_name: str(g('reporting_manager_name')),
      location_entity: str(g('location_entity')),
      visa_sponsor: str(g('visa_sponsor')),
      department: str(g('department')),
      job_title: str(g('job_title')),
      grade: str(g('grade')),
      nationality: titleCase(str(g('nationality'))),
      gender: str(g('gender')),
      employment_status: str(g('employment_status')),
      is_active: !/in\s*active/i.test(str(g('employment_status')) || ''),
      date_of_joining: date(g('date_of_joining')),
      date_of_birth: date(g('date_of_birth')),
      probation_days: int(g('probation_days')),
      probation_end_date: date(g('probation_end_date')),
      probation_status: str(g('probation_status')),
      resign_date: date(g('resign_date')),
      relieve_date: date(g('relieve_date')),
      resign_type: str(g('resign_type')),
      email: email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null,
      phone: str(g('phone')),
      phone_personal: str(g('phone_personal')),
      phone_extension: str(g('phone_extension'))?.replace(/\.0$/, '') || null,
      is_manager: !!yes(g('is_manager')),
      weekly_off1: str(g('weekly_off1')),
      weekly_off2: str(g('weekly_off2')),
      shift_start: time(g('shift_start')),
      shift_end: time(g('shift_end')),
      ess_created: yes(g('ess_created')),
      ess_user_id: str(g('ess_user_id')),
    });
  }
  rows.badEmails = badEmails;
  return rows;
}

const FIELDS = ['full_name', 'entity_id', 'department', 'job_title', 'reporting_manager_name', 'visa_sponsor', 'grade', 'nationality',
  'gender', 'date_of_birth', 'date_of_joining', 'probation_days', 'probation_end_date', 'probation_status', 'employment_status',
  'resign_type', 'resign_date', 'relieve_date', 'phone', 'phone_personal', 'phone_extension', 'is_manager', 'weekly_off1',
  'weekly_off2', 'shift_start', 'shift_end', 'ess_created', 'ess_user_id', 'is_active'];

// Runs the import inside a transaction; rolls back unless commit === true.
async function runImport(buffer, { commit, userId }) {
  const rows = await parse(buffer);
  if (!rows.length) throw Object.assign(new Error('No employee rows found'), { status: 400 });
  const c = await pool.connect();
  const report = { total: rows.length, created: 0, updated: 0, active: 0, inactive: 0, noEmail: 0,
    duplicateEmails: [], emailInUse: [], invalidEmails: rows.badEmails || [], unmatchedManagers: [], unknownEntity: [], byEntity: {}, skippedColumns: SKIPPED_GROUPS };
  try {
    await c.query('BEGIN');
    const ents = Object.fromEntries((await c.query('SELECT id, code, name FROM entities')).rows.map((e) => [e.code, e]));
    const empRole = (await c.query("SELECT id FROM roles WHERE name = 'Employee'")).rows[0]?.id
      || (await c.query('SELECT id FROM roles WHERE NOT is_system ORDER BY id LIMIT 1')).rows[0].id;

    const seenEmail = new Map();
    const idByCode = {};
    for (const r of rows) {
      // email: unique within file and not owned by a different employee
      if (r.email) {
        if (seenEmail.has(r.email)) { report.duplicateEmails.push(`${r.full_name} (same as ${seenEmail.get(r.email)})`); r.email = null; } else seenEmail.set(r.email, r.full_name);
      }
      if (r.email) {
        const other = (await c.query('SELECT employee_code FROM users WHERE lower(email) = $1', [r.email])).rows[0];
        if (other && other.employee_code !== r.employee_code) { report.emailInUse.push(r.full_name); r.email = null; }
      }
      if (!r.email) report.noEmail++;
      const code = entityCode(r.location_entity);
      r.entity_id = code && ents[code] ? ents[code].id : null;
      if (!r.entity_id && r.location_entity) report.unknownEntity.push(`${r.full_name} — ${r.location_entity}`);
      const ename = r.entity_id ? ents[code].name : 'Unallocated';
      report.byEntity[ename] = (report.byEntity[ename] || 0) + 1;
      report[r.is_active ? 'active' : 'inactive']++;

      const existing = (await c.query('SELECT id FROM users WHERE employee_code = $1', [r.employee_code])).rows[0];
      const vals = FIELDS.map((f) => r[f] ?? null);
      if (existing) {
        const sets = FIELDS.map((f, i) => `${f} = $${i + 1}`);
        vals.push(r.email);
        sets.push(`email = COALESCE($${vals.length}, email)`);
        vals.push(existing.id);
        await c.query(`UPDATE users SET ${sets.join(', ')}, hr_synced_at = now(), updated_at = now() WHERE id = $${vals.length}`, vals);
        idByCode[r.employee_code] = existing.id;
        report.updated++;
      } else {
        const cols = [...FIELDS, 'employee_code', 'email', 'role_id', 'hr_synced_at'];
        const v = [...vals, r.employee_code, r.email, empRole, new Date()];
        const { rows: ins } = await c.query(
          `INSERT INTO users (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, v);
        idByCode[r.employee_code] = ins[0].id;
        report.created++;
      }
    }
    // link reporting managers by name
    const byName = {};
    for (const r of rows) byName[nameKey(r.full_name)] = idByCode[r.employee_code];
    const missing = new Set();
    for (const r of rows) {
      let mid = null;
      if (r.reporting_manager_name) {
        mid = byName[nameKey(r.reporting_manager_name)] || null;
        if (!mid) missing.add(norm(r.reporting_manager_name));
      }
      await c.query('UPDATE users SET reporting_manager_id = $1 WHERE id = $2', [mid, idByCode[r.employee_code]]);
    }
    report.unmatchedManagers = [...missing];
    if (commit) {
      await c.query('INSERT INTO audit_log (user_id, action, entity_type, details) VALUES ($1, $2, $3, $4)',
        [userId, 'employee.import', 'user', JSON.stringify({ total: report.total, created: report.created, updated: report.updated })]);
      await c.query('COMMIT');
    } else {
      await c.query('ROLLBACK');
    }
    report.committed = !!commit;
    return report;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

module.exports = { runImport, parse };
