/**
 * Employee directory from the icku HR database (view da.employee_directory, read-only login).
 * Gives the dashboard its team mapping: who reports to whom, titles, locations, joining dates
 * and working status. Only the non-personal columns are read; date_of_birth and gender are
 * never selected, in line with the view's access terms.
 *
 * Connection (GitHub Actions secrets / local .env):
 *   ICKU_DB_HOST, ICKU_DB_PORT (5432), ICKU_DB_NAME (postgres), ICKU_DB_USER, ICKU_DB_PASSWORD,
 *   ICKU_DB_SCHEMA (da), ICKU_DB_SSL_CA (PEM certificate; when set the connection is verify-full,
 *   otherwise it is encrypted but the server certificate is not verified — noted in the payload).
 * Or a single ICKU_DB_URL (postgresql://user:password@host:5432/postgres).
 */
import { createRequire } from 'node:module';
import { attendanceFrom, fetchAttendanceRows } from './attendance.mjs';

const require = createRequire(import.meta.url);

export const DIRECTORY_COLUMNS = ['employee_id', 'employee_number', 'employee_number_key', 'full_name', 'job_title', 'department_name', 'sub_department', 'work_location', 'manager_employee_id', 'working_status', 'is_working', 'joined_on', 'exit_date', 'termination_type', 'tenure_days'];

export function normEmpNo(s) {
  return String(s == null ? '' : s).trim().toUpperCase().replace(/\s+/g, '');
}

/** Connection settings from the environment; null when nothing is configured. */
export function directoryConfig(env = process.env) {
  const url = env.ICKU_DB_URL && env.ICKU_DB_URL.trim();
  const host = env.ICKU_DB_HOST && env.ICKU_DB_HOST.trim();
  if (!url && !host) return null;
  return {
    url: url || undefined,
    host: host || undefined,
    port: Number(env.ICKU_DB_PORT || 5432),
    database: env.ICKU_DB_NAME || 'postgres',
    user: env.ICKU_DB_USER,
    password: env.ICKU_DB_PASSWORD,
    schema: env.ICKU_DB_SCHEMA || 'da',
    ca: env.ICKU_DB_SSL_CA ? env.ICKU_DB_SSL_CA.replace(/\\n/g, '\n') : null,
  };
}

/** Read the directory view. Returns plain rows keyed the way the dashboard uses them. */
export async function fetchDirectoryFromDb(cfg = directoryConfig()) {
  if (!cfg) throw new Error('icku directory is not configured (ICKU_DB_HOST or ICKU_DB_URL)');
  const { Client } = require('pg');
  const ssl = cfg.ca ? { ca: cfg.ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
  const client = new Client(cfg.url
    ? { connectionString: cfg.url, ssl, application_name: 'sales-dashboard-sync', statement_timeout: 30000 }
    : { host: cfg.host, port: cfg.port, database: cfg.database, user: cfg.user, password: cfg.password, ssl, application_name: 'sales-dashboard-sync', statement_timeout: 30000 });
  await client.connect();
  try {
    await client.query('set default_transaction_read_only = on');
    const schema = String(cfg.schema).replace(/[^A-Za-z0-9_]/g, '');
    const { rows } = await client.query(`select ${DIRECTORY_COLUMNS.join(', ')} from ${schema}.employee_directory`);
    // What else the login can read in the schema (names, kinds, columns, row counts only): the
    // Team Mapping page notes it, so new grants from the tech team are visible without a DB tool.
    let objects = [];
    try { objects = await listSchemaObjects(client, schema); } catch (err) { objects = [{ name: '(could not list objects)', kind: String(err?.message || err), columns: [], rows: null }]; }
    // Daily attendance of the sales department (status and hours only); never blocks the directory.
    const mapped = rows.map(toRow);
    let attendance = null; let attendanceError = '';
    try {
      const re = salesDepartmentRe();
      const sales = mapped.filter((r) => r.empNo && re.test(r.department || '')).map((r) => r.empNo);
      attendance = await fetchAttendanceRows(client, schema, sales, attendanceFrom());
    } catch (err) { attendanceError = String(err?.message || err); }
    return { rows: mapped, asOf: new Date().toISOString(), sslVerified: !!cfg.ca, objects, attendance, attendanceError };
  } finally {
    await client.end();
  }
}

/** Tables and views in the schema this login may read, with their columns and row counts. */
async function listSchemaObjects(client, schema) {
  const { rows: rels } = await client.query(`
    select c.relname as name, case c.relkind when 'r' then 'table' when 'v' then 'view' when 'm' then 'materialized view' when 'p' then 'partitioned table' when 'f' then 'foreign table' else c.relkind::text end as kind,
           obj_description(c.oid, 'pg_class') as comment, has_table_privilege(c.oid, 'SELECT') as can_select
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = $1 and c.relkind in ('r','v','m','p','f') order by c.relname`, [schema]);
  const out = [];
  for (const r of rels) {
    const { rows: cols } = await client.query('select column_name, data_type from information_schema.columns where table_schema = $1 and table_name = $2 order by ordinal_position', [schema, r.name]);
    let count = null;
    if (r.can_select) { try { const q = await client.query(`select count(*)::int as n from "${schema}"."${r.name.replace(/"/g, '""')}"`); count = q.rows[0].n; } catch { count = null; } }
    out.push({ name: r.name, kind: r.kind, comment: r.comment || '', readable: !!r.can_select, rows: count, columns: cols.map((c) => `${c.column_name} (${c.data_type})`) });
  }
  return out;
}

function iso(d) {
  if (!d) return '';
  if (d instanceof Date) return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const s = String(d);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

/** Map raw view rows (snake_case, as exported to JSON) to the row shape the sync uses. */
export function directoryRowsFromRaw(rows) { return rows.map(toRow); }

function toRow(r) {
  return {
    empId: String(r.employee_id ?? ''),
    empNo: normEmpNo(r.employee_number),
    empKey: String(r.employee_number_key ?? ''),
    name: String(r.full_name ?? '').trim(),
    title: String(r.job_title ?? '').trim(),
    department: String(r.department_name ?? '').trim(),
    subDepartment: String(r.sub_department ?? '').trim(),
    location: String(r.work_location ?? '').trim(),
    managerEmpId: String(r.manager_employee_id ?? ''),
    status: String(r.working_status ?? '').trim(),
    isWorking: r.is_working === true || String(r.working_status ?? '').toLowerCase() === 'working',
    joinedOn: iso(r.joined_on),
    exitDate: iso(r.exit_date),
    terminationType: String(r.termination_type ?? '').trim(),
    tenureDays: r.tenure_days == null ? null : Number(r.tenure_days),
  };
}

/**
 * Index by employee number with the manager resolved to a name and number.
 * When a number has several employment records the working one wins, then the latest joined.
 */
export function buildDirectoryIndex(rows) {
  const byEmpId = new Map(rows.map((r) => [r.empId, r]));
  const index = {};
  for (const r of rows) {
    if (!r.empNo) continue;
    const mgr = byEmpId.get(r.managerEmpId);
    const entry = { ...r, managerName: mgr ? mgr.name : '', managerEmpNo: mgr ? mgr.empNo : '' };
    const cur = index[r.empNo];
    if (!cur || (entry.isWorking && !cur.isWorking) || (entry.isWorking === cur.isWorking && entry.joinedOn > cur.joinedOn)) index[r.empNo] = entry;
  }
  return index;
}

const SALES_RE = /sales|business development/i;

/** Department names that count as the sales department (SALES_DEPARTMENT_MATCH, a regular expression; default: contains "sales"). */
export function salesDepartmentRe(env = process.env) {
  try { return new RegExp(env.SALES_DEPARTMENT_MATCH || 'sales', 'i'); } catch { return /sales/i; }
}

/** Employee numbers of everyone in the sales department (any status), from the directory index. */
export function salesEmpNos(index, env = process.env) {
  const re = salesDepartmentRe(env);
  const out = {};
  for (const e of Object.values(index || {})) if (e && e.empNo && re.test(e.department || '')) out[e.empNo] = true;
  return out;
}

/**
 * Rows the Team Mapping page shows: everyone in a sales department or with a sales title,
 * everyone with call activity, and every manager of those. Tuples keep the payload small:
 * [empNo, name, title, department, location, managerEmpNo, managerName, status, joinedOn, exitDate]
 */
export function directoryTeamRows(index, activeEmpNos = [], env = process.env) {
  const active = new Set(activeEmpNos.map(normEmpNo));
  const sales = salesDepartmentRe(env);
  const keep = new Map();
  for (const e of Object.values(index)) {
    if (sales.test(e.department || '') || (active.has(e.empNo) && sales.test(e.department || ''))) keep.set(e.empNo, e);
  }
  // A manager outside the sales department (a director, for example) is not listed; the people under
  // them keep the manager's name and the Team Mapping page groups them as reporting outside sales.
  for (const e of [...keep.values()]) { const m = e.managerEmpNo && index[e.managerEmpNo]; if (m && sales.test(m.department || '')) keep.set(e.managerEmpNo, m); }
  return [...keep.values()]
    .sort((a, b) => a.managerName.localeCompare(b.managerName) || a.name.localeCompare(b.name))
    .map((e) => [e.empNo, e.name, e.title, e.department, e.location, e.managerEmpNo, e.managerName, e.isWorking ? 'Working' : (e.status || 'Exited'), e.joinedOn, e.exitDate]);
}
