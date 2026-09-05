/**
 * Sync orchestration: Google Sheet → transform → Supabase tables + a prebuilt
 * dashboard snapshot. Idempotent; safe to run every few minutes.
 */
import { STALE_RUN_MINUTES, serviceAccount, sheetConfig } from './config.mjs';
import { fetchSheetsFromGoogle } from './sheets.mjs';
import { buildPayload } from './transform.mjs';

function activityRows(payload, syncedAt) {
  const idx = new Map(payload.fields.map((f, i) => [f.key, i]));
  const get = (row, key) => (idx.has(key) ? row[idx.get(key)] : null);
  const num = (v) => (v == null || v === '' ? 0 : Number(v) || 0);
  const dimKeys = payload.fields.filter((f) => f.kind === 'text' && f.key !== 'empId').map((f) => f.key);
  return payload.rows.map((row) => {
    const dims = {};
    for (const k of dimKeys) { const v = get(row, k); if (v != null && v !== '') dims[k] = String(v); }
    return {
      date: get(row, 'date'),
      emp_id: String(get(row, 'empId')),
      dialed: num(get(row, 'dialed')),
      dialed_connected: num(get(row, 'dialedConnected')),
      talk_time_dialed: num(get(row, 'talkTimeDialed')),
      incoming: num(get(row, 'incoming')),
      incoming_connected: num(get(row, 'incomingConnected')),
      talk_time_incoming: num(get(row, 'talkTimeIncoming')),
      not_connected: idx.has('notConnected') ? num(get(row, 'notConnected')) : null,
      dims,
      synced_at: syncedAt,
    };
  });
}

/**
 * @param {object} args
 * @param {import('./repo.mjs').Repo} args.repo
 * @param {'scheduled'|'manual'|'cli'|'selftest'} args.trigger
 * @param {() => Promise<{sheets: Record<string, any[][]>}>} [args.source]  defaults to Google Sheets
 * @param {object} [args.config]  defaults to sheetConfig()
 */
export async function runSync({ repo, trigger = 'manual', source, config }) {
  const cfg = config ?? sheetConfig();
  const last = await repo.getLastSync();
  if (last && last.status === 'running') {
    const ageMin = (Date.now() - Date.parse(last.started_at)) / 60000;
    if (ageMin < STALE_RUN_MINUTES) return { skipped: true, reason: `A sync started ${Math.round(ageMin)} min ago is still running.` };
  }
  const run = await repo.startSyncRun(trigger);
  const t0 = Date.now();
  try {
    const src = source ?? (() => fetchSheetsFromGoogle(cfg, serviceAccount()));
    const { sheets } = await src();
    const payload = buildPayload(sheets, cfg);
    if (!payload.rows.length) throw new Error(`No readable daily rows found. ${payload.meta.notes.join(' ')}`);
    const syncedAt = new Date().toISOString();
    const employees = payload.employees.map((e) => ({ id: e.id, name: e.name, manager: e.manager || null, tags: e.tags, team: e.team || null, status: e.status || null, updated_at: syncedAt }));
    await repo.upsertEmployees(employees);
    await repo.upsertActivity(activityRows(payload, syncedAt));
    await repo.deleteStale(syncedAt);
    payload.meta.syncedAt = syncedAt;
    payload.meta.syncRunId = run.id;
    payload.meta.trigger = trigger;
    payload.meta.buildMs = Date.now() - t0;
    await repo.saveSnapshot(payload);
    const summary = {
      status: 'success',
      source_mode: payload.meta.sourceMode,
      source_sheets: payload.meta.sourceSheets,
      row_count: payload.meta.rowCount,
      employee_count: payload.meta.employeeCount,
      date_from: payload.meta.dateRange?.from ?? null,
      date_to: payload.meta.dateRange?.to ?? null,
      notes: payload.meta.notes,
      duration_ms: Date.now() - t0,
    };
    await repo.finishSyncRun(run.id, summary);
    return { ok: true, runId: run.id, ...summary };
  } catch (err) {
    await repo.finishSyncRun(run.id, { status: 'error', error: String(err?.message || err), duration_ms: Date.now() - t0 });
    throw err;
  }
}

export function emptyPayload(notes = []) {
  return {
    meta: { sourceMode: 'none', sourceSheets: [], generatedAt: new Date().toISOString(), timezone: 'Asia/Kolkata', rowCount: 0, employeeCount: 0, dateRange: null, notes },
    fields: [], dims: [], employees: [], rows: [],
  };
}
