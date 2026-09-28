/**
 * Daily attendance of the sales department from the icku HR database (view da.attendance_day).
 * Only three things are read per employee per day: the attendance status, the hours worked and
 * whether the record was voided. Nothing else from the HR record reaches the dashboard.
 *
 * The served form is compact: one string per employee with one character per day.
 *   { asOf, from, to, statuses: ['Present', ...], counts: { Present: 1234, ... },
 *     emp: { EP1234: { s: '00-1…', h: '99-0…' } } }
 *   s[i]  status of day from+i as a base-36 index into `statuses`; '-' = no record that day
 *   h[i]  hours worked that day, rounded, base-36 (capped at 35); '-' = not recorded
 */

const DAY_MS = 86400000;
const CODE = '0123456789abcdefghijklmnopqrstuvwxyz';

function normEmpNo(s) {
  return String(s == null ? '' : s).trim().toUpperCase().replace(/\s+/g, '');
}

function iso(d) {
  if (!d) return '';
  if (d instanceof Date) return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const s = String(d);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

/** First day to read: ATTENDANCE_FROM (YYYY-MM-DD) or ATTENDANCE_DAYS back from today (default 270). */
export function attendanceFrom(env = process.env, now = new Date()) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(env.ATTENDANCE_FROM || '')) return env.ATTENDANCE_FROM;
  const days = Number(env.ATTENDANCE_DAYS) > 0 ? Number(env.ATTENDANCE_DAYS) : 270;
  return new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Read attendance rows for the given employee numbers from `from` onwards, on an open client.
 * Returns [{ empNo, date, status, hours }]; voided records are left out.
 */
export async function fetchAttendanceRows(client, schema, empNos, from) {
  const list = [...new Set((empNos || []).map(normEmpNo).filter(Boolean))];
  if (!list.length) return [];
  const { rows } = await client.query(
    `select employee_number, work_date, attendance_status, hours_worked
       from ${schema}.attendance_day
      where work_date >= $1::date
        and coalesce(is_voided, false) = false
        and upper(regexp_replace(employee_number, '\\s+', '', 'g')) = any($2::text[])
      order by employee_number, work_date`,
    [from, list],
  );
  return rows.map((r) => ({ empNo: normEmpNo(r.employee_number), date: iso(r.work_date), status: String(r.attendance_status ?? '').trim(), hours: r.hours_worked == null ? null : Number(r.hours_worked) })).filter((r) => r.empNo && r.date);
}

/** Compact form served to the dashboard (see the header). `keep` limits the employees when given. */
export function encodeAttendance(rows, { asOf = new Date().toISOString(), keep = null } = {}) {
  const list = (rows || []).filter((r) => r && r.empNo && r.date && (!keep || keep[r.empNo] || (keep.has && keep.has(r.empNo))));
  if (!list.length) return null;
  let from = list[0].date; let to = list[0].date;
  const counts = {};
  for (const r of list) { if (r.date < from) from = r.date; if (r.date > to) to = r.date; const k = r.status || '(blank)'; counts[k] = (counts[k] || 0) + 1; }
  // Most frequent statuses first, so the common ones get the first codes; beyond 35 they share 'z'.
  const statuses = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  const codeOf = new Map(statuses.map((s, i) => [s, CODE[Math.min(i, CODE.length - 1)]]));
  const t0 = Date.parse(`${from}T00:00:00Z`);
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - t0) / DAY_MS) + 1;
  const emp = {};
  for (const r of list) {
    let e = emp[r.empNo];
    if (!e) { e = { s: new Array(days).fill('-'), h: new Array(days).fill('-') }; emp[r.empNo] = e; }
    const i = Math.round((Date.parse(`${r.date}T00:00:00Z`) - t0) / DAY_MS);
    if (i < 0 || i >= days) continue;
    e.s[i] = codeOf.get(r.status || '(blank)');
    if (r.hours != null && isFinite(r.hours) && r.hours >= 0) e.h[i] = CODE[Math.min(35, Math.round(r.hours))];
  }
  for (const k of Object.keys(emp)) emp[k] = { s: emp[k].s.join(''), h: emp[k].h.join('') };
  return { asOf, from, to, statuses, counts, emp };
}
