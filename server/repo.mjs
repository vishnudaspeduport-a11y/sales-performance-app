/**
 * Data-access layer. Two implementations of the same small interface:
 *   createSupabaseRepo()  — production (service-role client, server only)
 *   createMemoryRepo()    — in-memory, for local dev and the self-test
 */
import { createClient } from '@supabase/supabase-js';
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
  };
}

export function createMemoryRepo() {
  const state = { runs: [], employees: new Map(), activity: new Map(), snapshots: [] };
  let nextId = 1;
  return {
    state,
    async getLastSync() { return state.runs[state.runs.length - 1] ?? null; },
    async startSyncRun(trigger) { const run = { id: nextId++, trigger, status: 'running', started_at: new Date().toISOString(), finished_at: null }; state.runs.push(run); return run; },
    async finishSyncRun(id, patch) { const run = state.runs.find((r) => r.id === id); if (run) Object.assign(run, patch, { finished_at: new Date().toISOString() }); },
    async upsertEmployees(rows) { for (const r of rows) state.employees.set(r.id, r); },
    async upsertActivity(rows) { for (const r of rows) state.activity.set(`${r.date}|${r.emp_id}`, r); },
    async deleteStale(syncedAt, authoritativeDates) { const auth = new Set(authoritativeDates); for (const [k, r] of state.activity) if (r.synced_at < syncedAt && auth.has(r.date)) state.activity.delete(k); },
    async listActivity() { return [...state.activity.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.emp_id.localeCompare(b.emp_id))); },
    async listEmployees() { return [...state.employees.values()].sort((a, b) => a.id.localeCompare(b.id)); },
    async saveSnapshot(payload) { state.snapshots.push({ payload, created_at: new Date().toISOString() }); if (state.snapshots.length > KEEP_SNAPSHOTS) state.snapshots.shift(); },
    async getLatestSnapshot() { return state.snapshots[state.snapshots.length - 1] ?? null; },
  };
}
