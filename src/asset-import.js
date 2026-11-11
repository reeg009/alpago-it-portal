// Import the "ALPAGO ASSET IT DETAILS" workbook into assets.
// - Each sheet row is a handover record; rows are grouped by serial number into one asset with history.
// - The current holder (last USING / NOT RETURNED row) is matched to an employee by name.
// - Admin accounts/passwords, Apple ID logins and credential-looking notes are never read or stored.
const ExcelJS = require('exceljs');
const { pool } = require('./db');

const HEAD = {
  'pr. no': 'purchase_ref', 'pr no': 'purchase_ref', 'pr ref no': 'purchase_ref', s: 'purchase_ref',
  'asset type': 'type', make: 'brand', model: 'model',
  'device condition': 'condition', 'device status': 'condition',
  'employee name': 'holder', status: 'status', 'serial number': 'serial',
  office: 'office', location: 'location',
  'operating system': 'os', processor: 'processor', ram: 'ram', memmory: 'ram', memory: 'ram',
  'hdd / ssd': 'storage', storage: 'storage', graphics: 'graphics', 'anydesk id': 'remote_id',
  note: 'notes', notes: 'notes',
};
const SKIPPED = 'admin accounts & passwords, Apple ID logins, credential notes';

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const hkey = (s) => norm(s).toLowerCase();
function cv(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cv(v.result);
    if ('text' in v) return cv(v.text);
    if (v.error) return null;
  }
  return v;
}
const str = (v) => { const s = norm(cv(v)); return s === '' || s === '-' || s === '_' ? null : s; };
const looksSecret = (s) => /@|pass|pwd|login|apple id/i.test(s || '');

function category(type, model) {
  const t = `${type || ''} ${model || ''}`.toUpperCase();
  if (/IPAD|TAB\b|TABLET|GALAXY TAB/.test(t)) return 'Tablet';
  if (/PHONE|MOBILE|IPHONE|GALAXY|XCOVER/.test(t)) return 'Mobile';
  if (/MAC STUDIO|ALL IN ONE|DESKTOP|MINI DESKTOP|OPTIPLEX|PRODESK/.test(t)) return 'Desktop';
  if (/SERVER|PROLIANT/.test(t)) return 'Server';
  if (/NAS|SONICWALL|FIREWALL|SWITCH|ROUTER|DVR|\bIT\b/.test(t)) return 'Network';
  if (/PRINTER/.test(t)) return 'Printer';
  if (/MONITOR/.test(t)) return 'Monitor';
  if (/LAPTOP|MACBOOK|NOTEBOOK/.test(t)) return 'Laptop';
  if (/KEYBOARD|PENCIL|MOUSE|CAMERA|SPEAKER|CLICK SHARE|HEADSET/.test(t)) return 'Peripheral';
  return 'Other';
}
const PREFIX = { Laptop: 'LT', Desktop: 'DT', Monitor: 'MN', Mobile: 'MB', Tablet: 'TB', Printer: 'PR', Network: 'NW', Server: 'SV', Peripheral: 'PH', Other: 'GN' };

function cleanLocation(s) {
  if (!s || s.includes('@')) return null;
  return s.toUpperCase().replace(/\bALAPGO\b/g, 'ALPAGO').replace(/^GOLDEN MILE( OFFICE)?$/, 'ALPAGO GOLDEN MILE')
    .replace(/^JOINERY$/, 'ALPAGO JOINERY').replace(/\s+/g, ' ');
}
const cleanBrand = (s) => (s ? s.toUpperCase().replace('HUWAEI', 'HUAWEI').replace(/\s*\(WHITE\)/, '') : s);

// ---------- name matching ----------
const TITLES = new Set(['MR', 'MRS', 'MS', 'MISS', 'DR', 'ENG', 'ENGR', 'SIR']);
const tokens = (s) => norm(s).toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((t) => t && !TITLES.has(t));
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const tokEq = (a, b, fuzzy) => a === b || (fuzzy && a.length >= 5 && b.length >= 5 && lev(a, b) <= (a.length >= 8 ? 2 : 1));
function coversAll(src, target, fuzzy) {
  const used = new Set();
  return src.every((t) => { const i = target.findIndex((x, k) => !used.has(k) && tokEq(t, x, fuzzy)); if (i < 0) return false; used.add(i); return true; });
}
function makeMatcher(people) {
  const list = people.map((p) => ({ ...p, toks: tokens(p.full_name) }));
  const exact = new Map(list.map((p) => [p.toks.join(' '), p]));
  const pick = (cands) => {
    if (cands.length === 1) return { person: cands[0] };
    const active = cands.filter((c) => c.is_active);
    if (active.length === 1) return { person: active[0] };
    return cands.length ? { ambiguous: cands.slice(0, 4).map((c) => c.full_name) } : null;
  };
  const NOT_PEOPLE = new Set(['IT', 'RECEPTION', 'FINANCE', 'ADMIN', 'HR', 'OFFICE', 'STORE', 'SPARE', 'STOCK', 'MEETING', 'ROOM',
    'PROJECTS', 'SITE', 'CNC', 'MACHINE', 'JOINERY', 'BACKUP', 'BACKUPS', 'TEMP', 'NEW', 'OLD', 'AUDITORS', 'PHONE', 'CEO', 'MARKETING']);
  return (raw) => {
    // drop bracketed notes and trailing " - note" parts: "SHAMIKH ( TEMP-GOLDEN MILE)", "AFFAN - CHINA"
    const name = norm(String(raw).replace(/\(.*?\)|\(.*$/g, ' ').split(/\s[-–]\s/)[0]);
    const FILLER = new Set(['HANDOVER', 'HANDED', 'OVER', 'TO', 'WITH', 'TEMP', 'NEW', 'ASSIST', 'AS', 'PER', 'GIVEN', 'BY', 'USING']);
    const t = tokens(name).filter((x) => !FILLER.has(x));
    if (!t.length || t.every((x) => NOT_PEOPLE.has(x))) return null;
    if (t.length === 1) {
      if (t[0].length < 3 || NOT_PEOPLE.has(t[0])) return null;
      const cands = list.filter((p) => p.toks.includes(t[0]));
      const r = pick(cands) || pick(list.filter((p) => p.toks.some((x) => tokEq(t[0], x, true))));
      return r?.person ? { person: r.person, weak: true } : r;
    }
    const ex = exact.get(t.join(' '));
    if (ex) return { person: ex };
    return pick(list.filter((p) => coversAll(t, p.toks, false)))
      || pick(list.filter((p) => coversAll(t, p.toks, true)))
      // first + last token of the sheet name (handles extra middle names in the sheet)
      || (t.length >= 3 ? pick(list.filter((p) => coversAll([t[0], t[t.length - 1]], p.toks, true))) : null);
  };
}

// ---------- parse ----------
async function parse(buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch {
    throw Object.assign(new Error('That file could not be read as an Excel (.xlsx) workbook'), { status: 400 });
  }
  const records = [];
  const sheets = [];
  wb.worksheets.forEach((ws, si) => {
    let headerRow = null;
    ws.eachRow((row, n) => { if (!headerRow && row.values.some((v) => hkey(cv(v)) === 'asset type')) headerRow = n; });
    if (!headerRow) return; // e.g. the Etisalat sheet
    const cols = {};
    ws.getRow(headerRow).values.forEach((v, i) => { const f = HEAD[hkey(cv(v))]; if (f && !cols[f]) cols[f] = i; });
    if (!cols.holder && !cols.serial) return;
    const isInfra = /computer/i.test(ws.name);
    const isMobile = /mobile|apple|tab/i.test(ws.name);
    let count = 0;
    for (let n = headerRow + 1; n <= ws.rowCount; n++) {
      const r = ws.getRow(n);
      const g = (f) => (cols[f] ? str(r.getCell(cols[f]).value) : null);
      const rec = {
        sheet: ws.name, order: si * 100000 + n, isInfra,
        purchase_ref: g('purchase_ref'), type: g('type'), brand: cleanBrand(g('brand')), model: g('model'),
        holder: g('holder'), status: (g('status') || '').toUpperCase(), serial: g('serial')?.toUpperCase() || null,
        // mobile sheet's "Office" column holds Apple ID logins — use LOCATION there
        location: cleanLocation(cols.location ? g('location') : (isMobile ? null : g('office'))),
        os: g('os'), processor: g('processor'), ram: g('ram'), storage: g('storage'), graphics: g('graphics'), remote_id: g('remote_id'),
        notes: g('notes'),
      };
      if (!rec.type && !rec.model && !rec.serial && !rec.holder) continue;
      if (looksSecret(rec.notes)) rec.notes = null;
      if (rec.ram && /^\d+(\.0)?$/.test(rec.ram)) rec.ram = `${parseInt(rec.ram, 10)} GB`;
      if (rec.graphics && /^\d+(\.0)?$/.test(rec.graphics)) rec.graphics = `${parseInt(rec.graphics, 10)} GB`;
      if (rec.remote_id) rec.remote_id = rec.remote_id.replace(/\.0$/, '');
      records.push(rec);
      count++;
    }
    sheets.push({ name: ws.name, rows: count });
  });
  if (!records.length) throw Object.assign(new Error('No asset rows found — is this the IT asset details workbook?'), { status: 400 });
  // group by serial; rows without serial stand alone
  const groups = new Map();
  const seen = {};
  records.forEach((r) => {
    let k;
    if (r.serial && r.serial.length >= 4) k = `S:${r.serial}`;
    else {
      // no usable serial: stable key from sheet + device + holder (+ occurrence count for identical rows)
      const base = ['R', r.sheet, r.type, r.brand, r.model, r.holder, r.purchase_ref].map((x) => norm(x).toUpperCase()).join('|');
      seen[base] = (seen[base] || 0) + 1;
      k = `${base}|${seen[base]}`;
    }
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  return { groups: [...groups.entries()].map(([k, g]) => Object.assign(g.sort((a, b) => a.order - b.order), { key: k })), sheets, rowCount: records.length };
}

const latest = (rows, f) => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i][f]) return rows[i][f]; return null; };

async function runImport(buffer, { commit, userId }) {
  const { groups, sheets, rowCount } = await parse(buffer);
  const report = { sheets, rows: rowCount, assets: groups.length, created: 0, updated: 0, assigned: 0, inUse: 0, inStock: 0,
    byCategory: {}, unmatched: [], weak: [], ambiguous: [], doubleAssigned: [], noSerial: 0, employeesInPortal: 0, skipped: SKIPPED };
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const people = (await c.query('SELECT id, full_name, is_active, entity_id FROM users')).rows;
    report.employeesInPortal = people.length;
    const match = makeMatcher(people);
    const nextNo = {};
    for (const [cat, p] of Object.entries(PREFIX)) {
      nextNo[cat] = (await c.query("SELECT COALESCE(MAX(substring(asset_tag FROM '(\\d+)$')::int), 0) AS n FROM assets WHERE asset_tag LIKE $1", [`ALP-${p}-%`])).rows[0].n;
    }
    let tick = 0;
    const stamp = () => new Date(Date.now() - 100000 + (tick++) * 10);

    for (const rows of groups) {
      const last = rows[rows.length - 1];
      const type = latest(rows, 'type');
      const model = latest(rows, 'model');
      const brand = latest(rows, 'brand');
      const cat = category(type, model);
      report.byCategory[cat] = (report.byCategory[cat] || 0) + 1;
      const serial = rows[0].serial && rows[0].serial.length >= 4 ? rows[0].serial : null;
      if (!serial) report.noSerial++;
      const name = model ? (brand && !model.toUpperCase().startsWith(brand.split(' ')[0]) ? `${brand} ${model}` : model) : (type || 'Unknown device');
      const label = `${name}${serial ? ` (${serial})` : ''}`;

      // current holder(s)
      const using = rows.filter((r) => r.status === 'USING' || r.status === 'NOT RETURNED');
      const holders = [...new Set(using.map((r) => r.holder).filter(Boolean))];
      const current = using.length ? using[using.length - 1] : null;
      const flags = [];
      if (holders.length > 1) { flags.push(`Sheet lists more than one current holder: ${holders.join(', ')}`); report.doubleAssigned.push(`${label}: ${holders.join(' / ')}`); }
      if (current?.status === 'NOT RETURNED') flags.push('Marked NOT RETURNED in the sheet');

      let assignedTo = null; let status = 'In Stock'; let sheetHolder = null;
      if (current && current.holder) {
        const m = match(current.holder);
        if (m?.person) {
          assignedTo = m.person.id; status = 'Assigned';
          if (m.weak) { flags.push(`Matched "${current.holder}" to ${m.person.full_name} on one name only — please confirm`); report.weak.push(`${label}: ${current.holder} → ${m.person.full_name}`); }
        }
        else {
          sheetHolder = current.holder;
          status = 'In Use';
          if (!current.isInfra) {
            if (m?.ambiguous) { flags.push(`Holder "${current.holder}" matches several employees: ${m.ambiguous.join(', ')}`); report.ambiguous.push(`${label} → ${current.holder}`); }
            else { flags.push(`Holder "${current.holder}" not found in employees`); report.unmatched.push(`${label} → ${current.holder}`); }
          }
        }
      } else if (current) {
        status = 'In Use';
      }
      if (status === 'Assigned') report.assigned++; else if (status === 'In Use') report.inUse++; else report.inStock++;
      const person = assignedTo ? people.find((p) => p.id === assignedTo) : null;
      const notes = [...new Set(rows.map((r) => r.notes).filter(Boolean))].join(' | ') || null;
      const fields = {
        name, category: cat, brand, model, serial_number: serial, status, condition: 'Good',
        purchase_ref: latest(rows, 'purchase_ref'), location: latest(rows, 'location'),
        entity_id: person?.entity_id || null, assigned_to: assignedTo,
        os: latest(rows, 'os'), processor: latest(rows, 'processor'), ram: latest(rows, 'ram'), storage: latest(rows, 'storage'),
        graphics: latest(rows, 'graphics'), remote_id: latest(rows, 'remote_id'), notes,
        sheet_holder: sheetHolder, review_flag: flags.join(' · ') || null,
      };

      const existing = (await c.query(
        'SELECT id, assigned_to, review_flag, status FROM assets WHERE import_key = $1 OR ($2::text IS NOT NULL AND upper(serial_number) = $2) ORDER BY id LIMIT 1',
        [rows.key, serial])).rows[0];
      fields.import_key = rows.key;
      if (existing) {
        // keep manual fixes: an unmatched sheet holder never removes an assignment made in the portal,
        // and an already-reviewed assignment to the same person stays reviewed
        if (existing.assigned_to && !fields.assigned_to && fields.sheet_holder) {
          Object.assign(fields, { assigned_to: existing.assigned_to, status: 'Assigned', sheet_holder: null, review_flag: null });
          const p2 = people.find((p) => p.id === existing.assigned_to); fields.entity_id = p2?.entity_id || fields.entity_id;
          assignedTo = existing.assigned_to;
        } else if (!existing.review_flag && existing.assigned_to && existing.assigned_to === fields.assigned_to) {
          fields.review_flag = null;
        }
        if (existing.status === 'Retired') fields.status = 'Retired';
        const keys = Object.keys(fields);
        await c.query(`UPDATE assets SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')},
                         assigned_at = CASE WHEN $${keys.length + 1}::int IS DISTINCT FROM assigned_to THEN now() ELSE assigned_at END,
                         updated_at = now() WHERE id = $${keys.length + 2}`,
          [...keys.map((k) => fields[k]), assignedTo, existing.id]);
        if (existing.assigned_to !== assignedTo) {
          await c.query("INSERT INTO asset_history (asset_id, action, from_user, to_user, performed_by, note) VALUES ($1,'Reassigned',$2,$3,$4,'IT sheet re-import')",
            [existing.id, existing.assigned_to, assignedTo, userId]);
        }
        report.updated++;
      } else {
        nextNo[cat] += 1;
        const tag = `ALP-${PREFIX[cat]}-${String(nextNo[cat]).padStart(5, '0')}`;
        const keys = ['asset_tag', ...Object.keys(fields), 'assigned_at'];
        const vals = [tag, ...Object.values(fields), assignedTo ? new Date() : null];
        const { rows: ins } = await c.query(`INSERT INTO assets (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, vals);
        const aid = ins[0].id;
        await c.query("INSERT INTO asset_history (asset_id, action, performed_by, note, created_at) VALUES ($1,'Imported',$2,$3,$4)",
          [aid, userId, `From IT sheet "${rows[0].sheet}"${fields.purchase_ref ? ` · PR ${fields.purchase_ref}` : ''}`, stamp()]);
        // handover history from the sheet, in sheet order
        for (const r of rows) {
          if (!r.holder) continue;
          const m = match(r.holder);
          const pid = m?.person?.id || null;
          const returned = r.status === 'RETURNED';
          await c.query('INSERT INTO asset_history (asset_id, action, from_user, to_user, performed_by, note, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [aid, returned ? 'Returned' : 'Assigned', returned ? pid : null, returned ? null : pid, userId,
             `${pid ? '' : `${r.holder} · `}sheet status ${r.status || 'blank'}${r.notes ? ` · ${r.notes}` : ''}`, stamp()]);
        }
        report.created++;
      }
    }
    if (commit) {
      await c.query('INSERT INTO audit_log (user_id, action, entity_type, details) VALUES ($1,$2,$3,$4)',
        [userId, 'asset.import', 'asset', JSON.stringify({ assets: report.assets, created: report.created, updated: report.updated, assigned: report.assigned })]);
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

module.exports = { runImport, makeMatcher };
