/**
 * Employee directory and attendance from the icku partner API (https://icku.eduport.in/partner/v1),
 * the replacement for the direct database connection in directory.mjs. Same output shape, so the
 * rest of the sync does not care which one is used.
 *
 *   ICKU_API_KEY   the partner key (GitHub Actions secret / local .env); when set, the API is used
 *   ICKU_API_BASE  optional, defaults to https://icku.eduport.in/partner/v1
 *
 * Endpoints used, all read-only: /employees (current staff), /former-employees (left), and
 * /attendance?date=… (everyone's status for one day). Attendance is kept day by day in one small
 * JSON file in the archive bucket (stats/attendance-api.json): each sync re-reads the last seven
 * days and fills in older missing days a few at a time, so one run never needs more than a few
 * dozen calls (the key allows 120 a minute). Only the sales department's rows are kept, and only
 * the status and the hours; nothing else from the attendance record reaches the dashboard.
 */
import { attendanceFrom } from './attendance.mjs';
import { normEmpNo, salesDepartmentRe } from './directory.mjs';

export const ATTENDANCE_STAT = 'attendance-api';
const DEFAULT_BASE = 'https://icku.eduport.in/partner/v1';
const DAY_MS = 86400000;
/** days always re-read (attendance of recent days changes as people clock in and leaves are approved) */
const RECENT_DAYS = 7;
/** older missing days filled in per run */
const BACKFILL_DAYS = 60;

export function ickuApiConfig(env = process.env) {
  const key = env.ICKU_API_KEY && env.ICKU_API_KEY.trim();
  if (!key) return null;
  return { key, base: (env.ICKU_API_BASE || DEFAULT_BASE).trim().replace(/\/+$/, '') };
}

async function call(cfg, path, params = {}, attempt = 0) {
  const url = new URL(cfg.base + path);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { authorization: `Bearer ${cfg.key}`, accept: 'application/json' } });
  if (res.status === 429 && attempt < 2) {
    const wait = Math.min(65, Number(res.headers.get('ratelimit-reset') || 10) + 1);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return call(cfg, path, params, attempt + 1);
  }
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok || !body || body.error) {
    const msg = body && body.error && body.error.message ? body.error.message : `HTTP ${res.status}`;
    throw new Error(`icku API ${path}: ${msg}`);
  }
  return body.data;
}

const str = (v) => String(v == null ? '' : v).trim();
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}/.test(str(v)) ? str(v).slice(0, 10) : '');

/** Current staff and former staff, in the row shape directory.mjs produces. */
export async function fetchEmployeeRows(cfg) {
  const rows = [];
  let cursor = null; let guard = 0;
  do {
    const d = await call(cfg, '/employees', { pageSize: 500, cursor });
    for (const e of d.employees || []) {
      rows.push({
        empId: str(e.employeeId) || str(e.id), empNo: normEmpNo(e.employeeNumber), empKey: '',
        name: str(e.name), title: str(e.jobTitle), department: str(e.department && e.department.name), subDepartment: '',
        location: str(e.location), managerEmpId: str(e.reportsTo), managerName: '',
        status: str(e.status) || 'Working', isWorking: str(e.status).toLowerCase() !== 'exited' && !isoDate(e.exitDate),
        joinedOn: isoDate(e.joinedOn), exitDate: isoDate(e.exitDate), terminationType: '', tenureDays: null,
      });
    }
    cursor = d.nextCursor || null;
  } while (cursor && ++guard < 50);
  cursor = null; guard = 0;
  do {
    const d = await call(cfg, '/former-employees', { pageSize: 500, cursor });
    for (const e of d.formerEmployees || []) {
      const empNo = normEmpNo(e.employeeNumber);
      rows.push({
        empId: str(e.employeeId) || `former:${empNo}:${isoDate(e.joinedOn)}`, empNo, empKey: '',
        name: str(e.name), title: str(e.jobTitle), department: str(typeof e.department === 'object' && e.department ? e.department.name : e.department), subDepartment: str(e.subDepartment),
        location: str(e.location), managerEmpId: '', managerName: str(e.reportingManager),
        status: 'Exited', isWorking: false,
        joinedOn: isoDate(e.joinedOn), exitDate: isoDate(e.exitDate), terminationType: str(e.exitType), tenureDays: null,
      });
    }
    cursor = d.nextCursor || null;
  } while (cursor && ++guard < 50);
  return rows;
}

/** The API's day state → the status words the dashboard already understands (blank = no record). */
export function attendanceStatus(day) {
  const state = str(day && day.state).toLowerCase();
  const half = !!(day && day.halfDay);
  if (state === 'present') return half ? 'half' : 'present';
  if (state === 'on-leave' || state === 'leave') return half ? 'half' : 'leave';
  if (state === 'absent') return 'absent';
  if (state === 'week-off' || state === 'weekoff') return 'off';
  if (state === 'holiday') return 'holiday';
  return ''; // not-employed, not-yet-recorded, anything new
}

const dayIso = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Bring the stored attendance up to date for the sales employees and return the rows
 * [{ empNo, date, status, hours }] that encodeAttendance takes.
 */
export async function maintainAttendance({ cfg, repo, salesEmpNos, from = attendanceFrom(), today = dayIso(Date.now() + 330 * 60000) }) {
  const sales = new Set((salesEmpNos || []).map(normEmpNo).filter(Boolean));
  let store = { days: {} };
  if (repo && typeof repo.downloadStat === 'function') {
    const saved = await repo.downloadStat(ATTENDANCE_STAT);
    if (saved) { try { const j = JSON.parse(saved.toString('utf8')); if (j && j.days && typeof j.days === 'object') store = j; } catch { store = { days: {} }; } }
  }
  const t0 = Date.parse(`${today}T00:00:00Z`);
  const wanted = [];
  for (let i = 0; i < RECENT_DAYS; i++) { const d = dayIso(t0 - i * DAY_MS); if (d >= from) wanted.push(d); }
  let filled = 0;
  for (let i = RECENT_DAYS; filled < BACKFILL_DAYS; i++) { const d = dayIso(t0 - i * DAY_MS); if (d < from) break; if (!store.days[d]) { wanted.push(d); filled++; } }
  const errors = [];
  for (const date of wanted) {
    try {
      const d = await call(cfg, '/attendance', { date });
      const day = {};
      for (const r of d.days || []) {
        const empNo = normEmpNo(r.employeeId || r.employeeNumber);
        if (!sales.has(empNo)) continue;
        const status = attendanceStatus(r);
        const hours = r.hours == null || !isFinite(Number(r.hours)) ? null : Number(r.hours);
        if (status || hours != null) day[empNo] = [status, hours];
      }
      store.days[date] = day;
    } catch (err) { errors.push(`${date}: ${String(err?.message || err)}`); if (errors.length >= 3) break; }
  }
  for (const d of Object.keys(store.days)) if (d < from) delete store.days[d];
  if (repo && typeof repo.uploadStat === 'function' && wanted.length) await repo.uploadStat(ATTENDANCE_STAT, Buffer.from(JSON.stringify(store), 'utf8'));
  const rows = [];
  for (const [date, day] of Object.entries(store.days)) for (const [empNo, v] of Object.entries(day)) rows.push({ empNo, date, status: v[0] || '', hours: v[1] });
  rows.sort((a, b) => (a.empNo < b.empNo ? -1 : a.empNo > b.empNo ? 1 : a.date < b.date ? -1 : 1));
  return { rows, daysRead: wanted.length, daysStored: Object.keys(store.days).length, errors };
}

/** Same return shape as fetchDirectoryFromDb, so sync.mjs can use either. */
export async function fetchDirectoryFromApi({ cfg = ickuApiConfig(), repo = null, env = process.env } = {}) {
  if (!cfg) throw new Error('icku API is not configured (ICKU_API_KEY)');
  const rows = await fetchEmployeeRows(cfg);
  const re = salesDepartmentRe(env);
  const sales = rows.filter((r) => r.empNo && re.test(r.department || '')).map((r) => r.empNo);
  let attendance = null; let attendanceError = '';
  try {
    const a = await maintainAttendance({ cfg, repo, salesEmpNos: sales, from: attendanceFrom(env) });
    attendance = a.rows;
    if (a.errors.length) attendanceError = `${a.errors.length} day(s) could not be read (${a.errors[0]})`;
  } catch (err) { attendanceError = String(err?.message || err); }
  return { rows, asOf: new Date().toISOString(), sslVerified: true, objects: [], attendance, attendanceError, source: 'api' };
}
