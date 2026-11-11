// Small helpers shared by routes
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const notFound = (what = 'Record') => new HttpError(404, `${what} not found`);
const forbidden = (msg = 'You do not have permission for this action') => new HttpError(403, msg);

const nil = (v) => (v === '' || v === undefined ? null : v);
const int = (v) => (v === '' || v === null || v === undefined ? null : parseInt(v, 10));

// Build an UPDATE statement from a whitelist of fields present in body
function buildUpdate(table, id, body, fields, extra = {}) {
  const sets = [];
  const vals = [];
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(body, f)) {
      vals.push(nil(body[f]));
      sets.push(`${f} = $${vals.length}`);
    }
  }
  for (const [k, v] of Object.entries(extra)) { vals.push(v); sets.push(`${k} = $${vals.length}`); }
  if (!sets.length) return null;
  vals.push(id);
  return { text: `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, values: vals };
}

function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

function paging(req) {
  const page = Math.max(1, int(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, int(req.query.pageSize) || 25));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

module.exports = { wrap, HttpError, bad, notFound, forbidden, nil, int, buildUpdate, toCsv, paging };
