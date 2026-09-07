/**
 * Sync orchestration: Google Sheet → transform → Supabase tables + a prebuilt
 * dashboard snapshot. Idempotent; safe to run every few minutes.
 */
import { archiveCallLog } from './archive.mjs';
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
    const { sheets, rawFull } = await src();
    const payload = buildPayload(sheets, cfg);
    if (!payload.rows.length) throw new Error(`No readable daily rows found. ${payload.meta.notes.join(' ')}`);
    const syncedAt = new Date().toISOString();
    const employees = payload.employees.map((e) => ({ id: e.id, name: e.name, manager: e.manager || null, tags: e.tags, team: e.team || null, status: e.status || null, updated_at: syncedAt }));
    await repo.upsertEmployees(employees);
    await repo.upsertActivity(activityRows(payload, syncedAt));
    await repo.deleteStale(syncedAt, payload.meta.authoritativeDates ?? []);
    // Archive the call-level rows for each date currently in the rotating tab.
    let archived = { dates: [], rows: 0 };
    try {
      archived = await archiveCallLog({ repo, rawFull, tz: cfg.tz, syncedAt });
    } catch (err) {
      // Archiving must never block the dashboard data; surface it in the notes instead.
      payload.meta.notes.push(`Call-log archive failed: ${String(err?.message || err)}`);
    }
    // The served payload is built from the database, which retains call-log days
    // the sheet has since overwritten.
    const final = assemblePayload(payload, await repo.listActivity(), await repo.listEmployees());
    final.meta.archivedDates = archived.dates;
    final.meta.syncedAt = syncedAt;
    final.meta.syncRunId = run.id;
    final.meta.trigger = trigger;
    final.meta.buildMs = Date.now() - t0;
    await repo.saveSnapshot(final);
    const summary = {
      status: 'success',
      source_mode: final.meta.sourceMode,
      source_sheets: final.meta.sourceSheets,
      row_count: final.meta.rowCount,
      employee_count: final.meta.employeeCount,
      date_from: final.meta.dateRange?.from ?? null,
      date_to: final.meta.dateRange?.to ?? null,
      notes: final.meta.notes,
      duration_ms: Date.now() - t0,
    };
    await repo.finishSyncRun(run.id, summary);
    return { ok: true, runId: run.id, ...summary };
  } catch (err) {
    await repo.finishSyncRun(run.id, { status: 'error', error: String(err?.message || err), duration_ms: Date.now() - t0 });
    throw err;
  }
}

const COLUMN_TO_FIELD = { dialed: 'dialed', dialed_connected: 'dialedConnected', talk_time_dialed: 'talkTimeDialed', incoming: 'incoming', incoming_connected: 'incomingConnected', talk_time_incoming: 'talkTimeIncoming', not_connected: 'notConnected' };

/**
 * Build the payload the dashboard serves from database rows. Field and dimension
 * definitions come from the sheet transform; rows and employees from the DB so
 * retained history is included.
 */
export function assemblePayload(sheetPayload, dbRows, dbEmployees) {
  const fields = sheetPayload.fields.length ? sheetPayload.fields : [];
  const metricFields = fields.filter((f) => f.kind === 'count' || f.kind === 'seconds');
  const dimFields = fields.filter((f) => f.kind === 'text' && f.key !== 'empId');
  const fieldToColumn = Object.fromEntries(Object.entries(COLUMN_TO_FIELD).map(([c, f]) => [f, c]));
  const sheetDates = new Set(sheetPayload.rows.map((r) => r[0]));
  const rows = [];
  let minDate = null; let maxDate = null; let retainedDays = new Set();
  for (const r of dbRows) {
    const date = typeof r.date === 'string' ? r.date.slice(0, 10) : String(r.date);
    const out = [date, r.emp_id];
    for (const f of metricFields) out.push(Number(r[fieldToColumn[f.key]] ?? 0) || 0);
    for (const d of dimFields) out.push((r.dims && r.dims[d.key]) || '');
    rows.push(out);
    if (!minDate || date < minDate) minDate = date;
    if (!maxDate || date > maxDate) maxDate = date;
    if (!sheetDates.has(date)) retainedDays.add(date);
  }
  const employees = dbEmployees.map((e) => ({ id: e.id, name: e.name || e.id, manager: e.manager || '', tags: Array.isArray(e.tags) ? e.tags : [], team: e.team || '', status: e.status || '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const dims = [];
  if (employees.some((e) => e.manager)) dims.push({ key: 'manager', label: 'Manager' });
  if (employees.some((e) => e.team)) dims.push({ key: 'team', label: 'Team' });
  if (employees.some((e) => e.tags.length)) dims.push({ key: 'tags', label: 'BDM / Tag', multi: true });
  if (employees.some((e) => e.status)) dims.push({ key: 'status', label: 'Status' });
  for (const d of sheetPayload.dims) if (d.perRow && !dims.some((x) => x.key === d.key)) dims.push(d);
  const notes = [...sheetPayload.meta.notes];
  if (retainedDays.size) notes.push(`${retainedDays.size} day(s) retained from earlier call-log syncs that are no longer present in the sheet.`);
  return {
    meta: {
      ...sheetPayload.meta,
      generatedAt: new Date().toISOString(),
      rowCount: rows.length,
      employeeCount: employees.length,
      dateRange: minDate ? { from: minDate, to: maxDate } : null,
      retainedDays: [...retainedDays].sort(),
      notes,
    },
    fields,
    dims,
    employees,
    rows,
  };
}

export function emptyPayload(notes = []) {
  return {
    meta: { sourceMode: 'none', sourceSheets: [], generatedAt: new Date().toISOString(), timezone: 'Asia/Kolkata', rowCount: 0, employeeCount: 0, dateRange: null, notes },
    fields: [], dims: [], employees: [], rows: [],
  };
}
