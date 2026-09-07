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
    /** Set band counts on existing rows only (never creates rows). */
    async updateBands(rows) {
      for (const r of rows) {
        unwrap(await client.from('daily_activity').update({ band_0_2: r.band_0_2, band_2_4: r.band_2_4, band_4_plus: r.band_4_plus, tt_band_0_2: r.tt_band_0_2 ?? 0, tt_band_2_4: r.tt_band_2_4 ?? 0, tt_band_4_plus: r.tt_band_4_plus ?? 0, unique_connected: r.unique_connected ?? null, uq_band_0_2: r.uq_band_0_2 ?? null, uq_band_2_4: r.uq_band_2_4 ?? null, uq_band_4_plus: r.uq_band_4_plus ?? null }).eq('date', r.date).eq('emp_id', r.emp_id));
      }
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
    /** Only the meta object of the latest snapshot (a few hundred bytes instead of the whole payload). */
    async getLatestSnapshotMeta() {
      const row = unwrap(await client.from('dashboard_snapshots').select('meta:payload->meta').order('created_at', { ascending: false }).limit(1).maybeSingle());
      return row?.meta ?? null;
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
  const state = { runs: [], employees: new Map(), activity: new Map(), snapshots: [], archives: new Map() };
  let nextId = 1;
  return {
    state,
    async getLastSync() { return state.runs[state.runs.length - 1] ?? null; },
    async startSyncRun(trigger) { const run = { id: nextId++, trigger, status: 'running', started_at: new Date().toISOString(), finished_at: null }; state.runs.push(run); return run; },
    async finishSyncRun(id, patch) { const run = state.runs.find((r) => r.id === id); if (run) Object.assign(run, patch, { finished_at: new Date().toISOString() }); },
    async upsertEmployees(rows) { for (const r of rows) state.employees.set(r.id, r); },
    async upsertActivity(rows) { for (const r of rows) { const k = `${r.date}|${r.emp_id}`; state.activity.set(k, { ...(state.activity.get(k) ?? {}), ...r }); } },
    async updateBands(rows) { for (const r of rows) { const k = `${r.date}|${r.emp_id}`; const cur = state.activity.get(k); if (cur) Object.assign(cur, { band_0_2: r.band_0_2, band_2_4: r.band_2_4, band_4_plus: r.band_4_plus, tt_band_0_2: r.tt_band_0_2 ?? 0, tt_band_2_4: r.tt_band_2_4 ?? 0, tt_band_4_plus: r.tt_band_4_plus ?? 0, unique_connected: r.unique_connected ?? null, uq_band_0_2: r.uq_band_0_2 ?? null, uq_band_2_4: r.uq_band_2_4 ?? null, uq_band_4_plus: r.uq_band_4_plus ?? null }); } },
    async deleteStale(syncedAt, authoritativeDates) { const auth = new Set(authoritativeDates); for (const [k, r] of state.activity) if (r.synced_at < syncedAt && auth.has(r.date)) state.activity.delete(k); },
    async listActivity() { return [...state.activity.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.emp_id.localeCompare(b.emp_id))); },
    async listEmployees() { return [...state.employees.values()].sort((a, b) => a.id.localeCompare(b.id)); },
    async saveSnapshot(payload) { state.snapshots.push({ payload, created_at: new Date().toISOString() }); if (state.snapshots.length > KEEP_SNAPSHOTS) state.snapshots.shift(); },
    async getLatestSnapshot() { return state.snapshots[state.snapshots.length - 1] ?? null; },
    async getLatestSnapshotMeta() { return state.snapshots[state.snapshots.length - 1]?.payload.meta ?? null; },
    async uploadArchive({ date, gz, rowCount, bytes, csvBytes, columns, syncedAt }) { state.archives.set(date, { date, gz, row_count: rowCount, bytes, csv_bytes: csvBytes, columns, updated_at: syncedAt ?? new Date().toISOString() }); },
    async listArchives() { return [...state.archives.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).map(({ gz, ...rest }) => rest); },
    async downloadArchive(date) { return state.archives.get(date)?.gz ?? null; },
  };
}
