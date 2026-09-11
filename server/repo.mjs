/**
 * Data-access layer. Two implementations of the same small interface:
 *   createSupabaseRepo()  — production (service-role client, server only)
 *   createMemoryRepo()    — in-memory, for local dev and the self-test
 */
import { createClient } from '@supabase/supabase-js';
import { ARCHIVE_BUCKET, archivePath } from './archive.mjs';
import { env } from './config.mjs';

const CHUNK = 1000;
const KEEP_SNAPSHOTS = 5;

function chunks(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function unwrap({ data, error }) {
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data;
}

export function createSupabaseRepo() {
  const client = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async getLastSync() {
      return unwrap(await client.from('sync_runs').select('*').order('started_at', { ascending: false }).limit(1).maybeSingle());
    },
    async startSyncRun(trigger) {
      return unwrap(await client.from('sync_runs').insert({ trigger, status: 'running' }).select().single());
    },
    async finishSyncRun(id, patch) {
      unwrap(await client.from('sync_runs').update({ ...patch, finished_at: new Date().toISOString() }).eq('id', id));
    },
    async upsertEmployees(rows) {
      for (const part of chunks(rows, CHUNK)) unwrap(await client.from('employees').upsert(part, { onConflict: 'id' }));
    },
    async upsertActivity(rows) {
      for (const part of chunks(rows, CHUNK)) unwrap(await client.from('daily_activity').upsert(part, { onConflict: 'date,emp_id' }));
    },
    /** Distinct dates whose rows were built from the call log (view call_log_dates). */
    async listCallLogDates() {
      const rows = unwrap(await client.from('call_log_dates').select('date'));
      return (rows ?? []).map((r) => (typeof r.date === 'string' ? r.date.slice(0, 10) : String(r.date)));
    },
    /** Insert employees that do not exist yet; never overwrites what is already stored. */
    async ensureEmployees(rows) {
      for (const part of chunks(rows, CHUNK)) unwrap(await client.from('employees').upsert(part, { onConflict: 'id', ignoreDuplicates: true }));
    },
    /** Remove rows the sheet no longer has — only for dates the sheet is authoritative for. */
    async deleteStale(syncedAt, authoritativeDates) {
      for (const part of chunks(authoritativeDates, 100)) unwrap(await client.from('daily_activity').delete().lt('synced_at', syncedAt).in('date', part));
    },
    async listActivity() {
      const out = [];
      for (let from = 0; ; from += CHUNK) {
        const page = unwrap(await client.from('daily_activity').select('*').order('date').order('emp_id').range(from, from + CHUNK - 1));
        out.push(...page);
        if (page.length < CHUNK) break;
      }
      return out;
    },
    async listEmployees() {
      const out = [];
      for (let from = 0; ; from += CHUNK) {
        const page = unwrap(await client.from('employees').select('*').order('id').range(from, from + CHUNK - 1));
        out.push(...page);
        if (page.length < CHUNK) break;
      }
      return out;
    },
    async saveSnapshot(payload) {
      unwrap(await client.from('dashboard_snapshots').insert({ payload, generated_at: payload.meta.generatedAt }));
      const old = unwrap(await client.from('dashboard_snapshots').select('id').order('created_at', { ascending: false }).range(KEEP_SNAPSHOTS, KEEP_SNAPSHOTS + 50));
      if (old?.length) unwrap(await client.from('dashboard_snapshots').delete().in('id', old.map((r) => r.id)));
    },
    async getLatestSnapshot() {
      return unwrap(await client.from('dashboard_snapshots').select('payload, created_at').order('created_at', { ascending: false }).limit(1).maybeSingle());
    },
    /** Creation time of the latest snapshot only. */
    async getLatestSnapshotAt() {
      const row = unwrap(await client.from('dashboard_snapshots').select('created_at').order('created_at', { ascending: false }).limit(1).maybeSingle());
      return row?.created_at ?? null;
    },
    /** Only the meta object of the latest snapshot (a few hundred bytes instead of the whole payload). */
    async getLatestSnapshotMeta() {
      const row = unwrap(await client.from('dashboard_snapshots').select('meta:payload->meta').order('created_at', { ascending: false }).limit(1).maybeSingle());
      return row?.meta ?? null;
    },
    /* ---- pending tasks snapshots ---- */
    async replacePendingDay(date, rows, teamRows) {
      unwrap(await client.from('pending_tasks_daily').delete().eq('date', date));
      for (const part of chunks(rows, CHUNK)) unwrap(await client.from('pending_tasks_daily').insert(part));
      unwrap(await client.from('pending_team_daily').delete().eq('date', date));
      for (const part of chunks(teamRows, CHUNK)) unwrap(await client.from('pending_team_daily').insert(part));
    },
    async getPendingLatestDate() {
      const row = unwrap(await client.from('pending_tasks_daily').select('date').order('date', { ascending: false }).limit(1).maybeSingle());
      return row ? String(row.date).slice(0, 10) : null;
    },
    async listPendingRows(date) {
      const out = [];
      for (let from = 0; ; from += CHUNK) {
        const page = unwrap(await client.from('pending_tasks_daily').select('source,team,owner,subject,bucket,kind,age,count').eq('date', date).range(from, from + CHUNK - 1));
        out.push(...page);
        if (page.length < CHUNK) break;
      }
      return out;
    },
    async listPendingHistory(fromDate) {
      return unwrap(await client.from('pending_team_daily').select('date,team,ic_today,ic_overdue,lm_today,lm_overdue,ic_today_owner,ic_overdue_owner,lm_today_owner,lm_overdue_owner,bdes').gte('date', fromDate).order('date'));
    },
    /* ---- call-log archive (Supabase Storage + index table) ---- */
    async uploadArchive({ date, gz, rowCount, bytes, csvBytes, columns, syncedAt }) {
      const { error } = await client.storage.from(ARCHIVE_BUCKET).upload(archivePath(date), gz, { contentType: 'application/gzip', upsert: true });
      if (error) throw new Error(`Supabase Storage: ${error.message}`);
      unwrap(await client.from('call_log_archives').upsert({ date, row_count: rowCount, bytes, csv_bytes: csvBytes, columns, path: archivePath(date), updated_at: syncedAt ?? new Date().toISOString() }, { onConflict: 'date' }));
    },
    async listArchives() {
      return unwrap(await client.from('call_log_archives').select('date, row_count, bytes, csv_bytes, columns, updated_at').order('date', { ascending: false }));
    },
    async downloadArchive(date) {
      const { data, error } = await client.storage.from(ARCHIVE_BUCKET).download(archivePath(date));
      if (error) { if (/not found|404/i.test(error.message)) return null; throw new Error(`Supabase Storage: ${error.message}`); }
      return Buffer.from(await data.arrayBuffer());
    },
  };
}

export function createMemoryRepo() {
  const state = { runs: [], employees: new Map(), activity: new Map(), snapshots: [], archives: new Map(), pending: new Map(), pendingTeams: new Map() };
  let nextId = 1;
  return {
    state,
    async getLastSync() { return state.runs[state.runs.length - 1] ?? null; },
    async startSyncRun(trigger) { const run = { id: nextId++, trigger, status: 'running', started_at: new Date().toISOString(), finished_at: null }; state.runs.push(run); return run; },
    async finishSyncRun(id, patch) { const run = state.runs.find((r) => r.id === id); if (run) Object.assign(run, patch, { finished_at: new Date().toISOString() }); },
    async upsertEmployees(rows) { for (const r of rows) state.employees.set(r.id, r); },
    async upsertActivity(rows) { for (const r of rows) { const k = `${r.date}|${r.emp_id}`; state.activity.set(k, { ...(state.activity.get(k) ?? {}), ...r }); } },
    async listCallLogDates() { return [...new Set([...state.activity.values()].filter((r) => r.source === 'call-log').map((r) => r.date))].sort(); },
    async ensureEmployees(rows) { for (const r of rows) if (!state.employees.has(r.id)) state.employees.set(r.id, { manager: null, team: null, status: null, ...r }); },
    async deleteStale(syncedAt, authoritativeDates) { const auth = new Set(authoritativeDates); for (const [k, r] of state.activity) if (r.synced_at < syncedAt && auth.has(r.date)) state.activity.delete(k); },
    async listActivity() { return [...state.activity.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.emp_id.localeCompare(b.emp_id))); },
    async listEmployees() { return [...state.employees.values()].sort((a, b) => a.id.localeCompare(b.id)); },
    async saveSnapshot(payload) { state.snapshots.push({ payload, created_at: new Date().toISOString() }); if (state.snapshots.length > KEEP_SNAPSHOTS) state.snapshots.shift(); },
    async getLatestSnapshot() { return state.snapshots[state.snapshots.length - 1] ?? null; },
    async getLatestSnapshotMeta() { return state.snapshots[state.snapshots.length - 1]?.payload.meta ?? null; },
    async getLatestSnapshotAt() { return state.snapshots[state.snapshots.length - 1]?.created_at ?? null; },
    async replacePendingDay(date, rows, teamRows) { state.pending.set(date, rows.map((r) => ({ ...r }))); state.pendingTeams.set(date, teamRows.map((r) => ({ ...r }))); },
    async getPendingLatestDate() { return [...state.pending.keys()].sort().pop() ?? null; },
    async listPendingRows(date) { return (state.pending.get(date) ?? []).map(({ source, team, owner, subject, bucket, kind, age, count }) => ({ source, team, owner, subject, bucket, kind, age: age ?? '', count })); },
    async listPendingHistory(fromDate) { return [...state.pendingTeams.entries()].filter(([d]) => d >= fromDate).sort().flatMap(([, rows]) => rows); },
    async uploadArchive({ date, gz, rowCount, bytes, csvBytes, columns, syncedAt }) { state.archives.set(date, { date, gz, row_count: rowCount, bytes, csv_bytes: csvBytes, columns, updated_at: syncedAt ?? new Date().toISOString() }); },
    async listArchives() { return [...state.archives.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).map(({ gz, ...rest }) => rest); },
    async downloadArchive(date) { return state.archives.get(date)?.gz ?? null; },
  };
}
