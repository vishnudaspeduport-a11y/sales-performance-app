/**
 * Sync orchestration: Google Sheet → transform → Supabase tables + a prebuilt
 * dashboard snapshot. Idempotent; safe to run every few minutes.
 */
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { archiveCallLog, parseCsv } from './archive.mjs';
import { STALE_RUN_MINUTES, serviceAccount, sheetConfig } from './config.mjs';
import { fetchSheetsFromGoogle } from './sheets.mjs';
import { buildFromCallLog, buildPayload } from './transform.mjs';

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
      // present only for rows that came from the call log (see splitByBands)
      ...(idx.has('band02') && get(row, 'band02') != null ? { band_0_2: num(get(row, 'band02')), band_2_4: num(get(row, 'band24')), band_4_plus: num(get(row, 'band4p')) } : {}),
    };
  });
}

/**
 * Rows with band counts and rows without must be upserted separately: an upsert
 * only touches the columns it carries, so helper-only rows leave existing band
 * values (from an earlier call-log sync) untouched.
 */
function splitByBands(rows) {
  const withBands = rows.filter((r) => r.band_0_2 != null);
  const withoutBands = rows.filter((r) => r.band_0_2 == null);
  return { withBands, withoutBands };
}

/**
 * Compute bands for retained days that have none yet, from the archived CSVs
 * (covers days archived before the band columns existed). Bounded per run.
 */
async function backfillBandsFromArchives({ repo, dbRows, cfg, syncedAt, limit = 5 }) {
  if (typeof repo.listArchives !== 'function' || typeof repo.downloadArchive !== 'function') return [];
  const missing = new Set();
  for (const r of dbRows) if (r.band_0_2 == null) missing.add(typeof r.date === 'string' ? r.date.slice(0, 10) : String(r.date));
  if (!missing.size) return [];
  const archives = await repo.listArchives();
  const todo = archives.map((a) => (typeof a.date === 'string' ? a.date.slice(0, 10) : String(a.date))).filter((d) => missing.has(d)).sort().reverse().slice(0, limit);
  const done = [];
  for (const date of todo) {
    const gz = await repo.downloadArchive(date);
    if (!gz) continue;
    const table = parseCsv(gunzipSync(gz).toString('utf8'));
    if (table.length < 2) continue;
    const built = buildFromCallLog(table, cfg.tz, []);
    const rows = [];
    for (const key of built.store.order) {
      const rec = built.store.byKey[key];
      if (rec.date !== date) continue;
      rows.push({ date: rec.date, emp_id: rec.empId, band_0_2: rec.band02 ?? 0, band_2_4: rec.band24 ?? 0, band_4_plus: rec.band4p ?? 0 });
    }
    if (rows.length) { await repo.updateBands(rows, syncedAt); done.push(date); }
  }
  return done;
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
    // Change detection: scheduled runs skip all database work when the sheet content
    // is identical to what the last snapshot was built from. Manual/CLI runs always
    // proceed (so a Refresh can force a rebuild, e.g. after a schema change).
    const contentHash = createHash('sha1').update(JSON.stringify([payload.fields, payload.rows, payload.employees, rawFull ? rawFull.rows.length : 0])).digest('hex');
    if (trigger === 'scheduled' && typeof repo.getLatestSnapshotMeta === 'function') {
      const lastMeta = await repo.getLatestSnapshotMeta();
      if (lastMeta && lastMeta.contentHash === contentHash) {
        const summary = { status: 'success', source_mode: payload.meta.sourceMode, source_sheets: payload.meta.sourceSheets, row_count: lastMeta.rowCount ?? payload.meta.rowCount, employee_count: lastMeta.employeeCount ?? payload.meta.employeeCount, date_from: lastMeta.dateRange?.from ?? null, date_to: lastMeta.dateRange?.to ?? null, notes: ['Sheet unchanged since the last snapshot; database left as is.'], duration_ms: Date.now() - t0 };
        await repo.finishSyncRun(run.id, summary);
        return { ok: true, runId: run.id, unchanged: true, ...summary };
      }
    }
    payload.meta.contentHash = contentHash;
    const syncedAt = new Date().toISOString();
    const employees = payload.employees.map((e) => ({ id: e.id, name: e.name, manager: e.manager || null, tags: e.tags, team: e.team || null, status: e.status || null, updated_at: syncedAt }));
    await repo.upsertEmployees(employees);
    const { withBands, withoutBands } = splitByBands(activityRows(payload, syncedAt));
    if (withoutBands.length) await repo.upsertActivity(withoutBands);
    if (withBands.length) await repo.upsertActivity(withBands);
    await repo.deleteStale(syncedAt, payload.meta.authoritativeDates ?? []);
    // Archive the call-level rows for each date currently in the rotating tab.
    let archived = { dates: [], rows: 0 };
    try {
      archived = await archiveCallLog({ repo, rawFull, tz: cfg.tz, syncedAt });
    } catch (err) {
      // Archiving must never block the dashboard data; surface it in the notes instead.
      payload.meta.notes.push(`Call-log archive failed: ${String(err?.message || err)}`);
    }
    // Fill in duration bands for retained days from their archived CSVs (bounded per run).
    let dbRows = await repo.listActivity();
    let backfilled = [];
    try {
      backfilled = await backfillBandsFromArchives({ repo, dbRows, cfg, syncedAt });
      if (backfilled.length) dbRows = await repo.listActivity();
    } catch (err) {
      payload.meta.notes.push(`Duration-band backfill failed: ${String(err?.message || err)}`);
    }
    // The served payload is built from the database, which retains call-log days
    // the sheet has since overwritten.
    const final = assemblePayload(payload, dbRows, await repo.listEmployees());
    final.meta.archivedDates = archived.dates;
    final.meta.bandBackfilledDates = backfilled;
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

const COLUMN_TO_FIELD = { dialed: 'dialed', dialed_connected: 'dialedConnected', talk_time_dialed: 'talkTimeDialed', incoming: 'incoming', incoming_connected: 'incomingConnected', talk_time_incoming: 'talkTimeIncoming', not_connected: 'notConnected', band_0_2: 'band02', band_2_4: 'band24', band_4_plus: 'band4p' };
const BAND_FIELDS = [
  { key: 'band02', label: 'Calls 0-2 min', concept: 'band02', kind: 'count' },
  { key: 'band24', label: 'Calls 2-4 min', concept: 'band24', kind: 'count' },
  { key: 'band4p', label: 'Calls over 4 min', concept: 'band4p', kind: 'count' },
];

/**
 * Build the payload the dashboard serves from database rows. Field and dimension
 * definitions come from the sheet transform; rows and employees from the DB so
 * retained history is included.
 */
export function assemblePayload(sheetPayload, dbRows, dbEmployees) {
  let fields = sheetPayload.fields.length ? [...sheetPayload.fields] : [];
  // Band fields must be present whenever the database holds band data, even if
  // today's sheet read had no call log.
  if (fields.length && !fields.some((f) => f.key === 'band02') && dbRows.some((r) => r.band_0_2 != null)) {
    const lastMetric = Math.max(...fields.map((f, i) => (f.kind === 'count' || f.kind === 'seconds' ? i : -1)));
    fields.splice(lastMetric + 1, 0, ...BAND_FIELDS);
  }
  const metricFields = fields.filter((f) => f.kind === 'count' || f.kind === 'seconds');
  const dimFields = fields.filter((f) => f.kind === 'text' && f.key !== 'empId');
  const fieldToColumn = Object.fromEntries(Object.entries(COLUMN_TO_FIELD).map(([c, f]) => [f, c]));
  const sheetDates = new Set(sheetPayload.rows.map((r) => r[0]));
  const rows = [];
  let minDate = null; let maxDate = null; let retainedDays = new Set();
  for (const r of dbRows) {
    const date = typeof r.date === 'string' ? r.date.slice(0, 10) : String(r.date);
    const out = [date, r.emp_id];
    for (const f of metricFields) {
      const v = r[fieldToColumn[f.key]];
      out.push(f.key.startsWith('band') ? (v == null ? null : Number(v) || 0) : Number(v ?? 0) || 0);
    }
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
