/**
 * Sync orchestration: Google Sheet → transform → Supabase tables + a prebuilt
 * dashboard snapshot. Idempotent; safe to run every few minutes.
 */
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { archiveCallLog, parseCsv } from './archive.mjs';
import { STALE_RUN_MINUTES, serviceAccount, sheetConfig } from './config.mjs';
import { buildDirectoryIndex, directoryConfig, directoryTeamRows, fetchDirectoryFromDb, salesEmpNos } from './directory.mjs';
import { buildPendingSnapshot, pendingTeamTotals } from './pending.mjs';
import { buildPendingFromSalesforce, fetchPendingFromSalesforce, salesforceConfig } from './salesforce.mjs';
import { fetchPendingFromGoogle, fetchSheetsFromGoogle } from './sheets.mjs';
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
      source: idx.has('band02') && get(row, 'band02') != null ? 'call-log' : 'helper',
      dims,
      synced_at: syncedAt,
      // present only for rows that came from the call log (see splitByBands)
      ...(idx.has('band02') && get(row, 'band02') != null ? callLogColumns(row, get, num, idx) : {}),
    };
  });
}

/** Columns that only call-log days carry (duration bands, talk time per band, unique connected). */
function callLogColumns(row, get, num, idx) {
  return {
    band_0_2: num(get(row, 'band02')), band_2_4: num(get(row, 'band24')), band_4_plus: num(get(row, 'band4p')),
    tt_band_0_2: num(get(row, 'ttBand02')), tt_band_2_4: num(get(row, 'ttBand24')), tt_band_4_plus: num(get(row, 'ttBand4p')),
    unique_connected: idx.has('uniqueConnected') && get(row, 'uniqueConnected') != null ? num(get(row, 'uniqueConnected')) : null,
    uq_band_0_2: idx.has('uqBand02') && get(row, 'uqBand02') != null ? num(get(row, 'uqBand02')) : null,
    uq_band_2_4: idx.has('uqBand24') && get(row, 'uqBand24') != null ? num(get(row, 'uqBand24')) : null,
    uq_band_4_plus: idx.has('uqBand4p') && get(row, 'uqBand4p') != null ? num(get(row, 'uqBand4p')) : null,
    missed: idx.has('missed') && get(row, 'missed') != null ? num(get(row, 'missed')) : null,
    rejected: idx.has('rejected') && get(row, 'rejected') != null ? num(get(row, 'rejected')) : null,
  };
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
 * Rebuild archived call-log days whose database rows were not built from the call log
 * (rows written before the call-log rules, or helper rows for a day whose log has since
 * rotated out of the sheet). Each rebuilt day becomes a complete call-log day. Bounded per run.
 */
/**
 * Emp Codes in the last `limit` archived call-log days that are not in `knownIds`, with the name and
 * tags from the log and calls per day: [code, name, managerHint, {date: calls}, total].
 */
/** The Emp Tag that names a manager ("Nivya" in "Nivya K V"), else the first tag. */
function managerFromTags(tags, managerNames) {
  const parts = String(tags || '').split(/;|,|\|/).map((t) => t.trim()).filter(Boolean);
  for (const t of parts) {
    const hit = managerNames.find((m) => m.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(m.toLowerCase()));
    if (hit) return hit;
  }
  return parts[0] || '';
}

async function unknownFromArchives({ repo, cfg, knownIds, helperManagers, managerNames = [], limit = 2 }) {
  if (typeof repo.listArchives !== 'function' || typeof repo.downloadArchive !== 'function') return null;
  const known = new Set(knownIds || []);
  const dates = (await repo.listArchives()).map((a) => (typeof a.date === 'string' ? a.date.slice(0, 10) : String(a.date))).sort().reverse().slice(0, limit);
  const acc = new Map();
  const used = [];
  for (const date of dates) {
    const gz = await repo.downloadArchive(date);
    if (!gz) continue;
    const table = parseCsv(gunzipSync(gz).toString('utf8'));
    if (table.length < 2) continue;
    used.push(date);
    const built = buildFromCallLog(table, cfg.tz, []);
    for (const key of built.store.order) {
      const rec = built.store.byKey[key];
      if (rec.date !== date || known.has(rec.empId)) continue;
      let u = acc.get(rec.empId);
      if (!u) { u = { name: built.names[rec.empId] || '', tags: built.tags[rec.empId] || '', byDate: {}, calls: 0 }; acc.set(rec.empId, u); }
      const n = (rec.dialed || 0) + (rec.incoming || 0);
      u.byDate[date] = (u.byDate[date] || 0) + n; u.calls += n;
    }
  }
  const rows = [...acc.entries()].map(([id, u]) => [id, u.name, (helperManagers && helperManagers[id]) || managerFromTags(u.tags, managerNames), u.byDate, u.calls])
    .sort((a, b) => b[4] - a[4] || String(a[1]).localeCompare(String(b[1])));
  return { dates: used, rows };
}

async function rebuildFromArchives({ repo, cfg, syncedAt, helperEmpIds, haveDates, skipDates, limit = 6 }) {
  if (typeof repo.listArchives !== 'function' || typeof repo.downloadArchive !== 'function') return [];
  const archives = await repo.listArchives();
  const todo = archives.map((a) => (typeof a.date === 'string' ? a.date.slice(0, 10) : String(a.date)))
    .filter((d) => !haveDates.has(d) && !skipDates.has(d)).sort().reverse().slice(0, limit);
  const scope = helperEmpIds && helperEmpIds.length ? new Set(helperEmpIds) : null;
  const done = [];
  for (const date of todo) {
    const gz = await repo.downloadArchive(date);
    if (!gz) continue;
    const table = parseCsv(gunzipSync(gz).toString('utf8'));
    if (table.length < 2) continue;
    const built = buildFromCallLog(table, cfg.tz, []);
    const rows = []; const emps = [];
    for (const key of built.store.order) {
      const rec = built.store.byKey[key];
      if (rec.date !== date) continue;
      if (scope && !scope.has(rec.empId)) continue;
      rows.push(callLogRow(rec, syncedAt));
      const tg = built.tags[rec.empId] ? String(built.tags[rec.empId]).split(/;|,|\|/).map((t) => t.trim()).filter(Boolean) : [];
      emps.push({ id: rec.empId, name: built.names[rec.empId] || rec.empId, tags: tg, updated_at: syncedAt });
    }
    if (!rows.length) continue;
    if (typeof repo.ensureEmployees === 'function') await repo.ensureEmployees(emps);
    await repo.upsertActivity(rows);
    await repo.deleteStale(syncedAt, [date]);
    done.push(date);
  }
  return done;
}

/** Database row for one call-log employee-day (every call-log column present). */
function callLogRow(rec, syncedAt) {
  return {
    date: rec.date, emp_id: rec.empId,
    dialed: rec.dialed || 0, dialed_connected: rec.dialedConnected || 0, talk_time_dialed: rec.talkTimeDialed || 0,
    incoming: rec.incoming || 0, incoming_connected: rec.incomingConnected || 0, talk_time_incoming: rec.talkTimeIncoming || 0,
    not_connected: null, dims: {}, synced_at: syncedAt, source: 'call-log',
    band_0_2: rec.band02 ?? 0, band_2_4: rec.band24 ?? 0, band_4_plus: rec.band4p ?? 0,
    tt_band_0_2: rec.ttBand02 ?? 0, tt_band_2_4: rec.ttBand24 ?? 0, tt_band_4_plus: rec.ttBand4p ?? 0,
    unique_connected: rec.uniqueConnected ?? 0, uq_band_0_2: rec.uqBand02 ?? 0, uq_band_2_4: rec.uqBand24 ?? 0, uq_band_4_plus: rec.uqBand4p ?? 0,
    missed: rec.missed ?? 0, rejected: rec.rejected ?? 0,
  };
}

/**
 * @param {object} args
 * @param {import('./repo.mjs').Repo} args.repo
 * @param {'scheduled'|'manual'|'cli'|'selftest'} args.trigger
 * @param {() => Promise<{sheets: Record<string, any[][]>}>} [args.source]  defaults to Google Sheets
 * @param {object} [args.config]  defaults to sheetConfig()
 * @param {() => Promise<{sheets?: Record<string, any[][]>, salesforce?: {tasks: object[], users: object[], asOf?: string}}>} [args.pendingSource]
 *   the Pending Tasks source: Salesforce when SF_LOGIN_URL is set, else the Google sheet (when `source` is not overridden)
 * @param {string} [args.pendingToday]  YYYY-MM-DD for the pending snapshot (tests / previews)
 * @param {'auto'|'sheet'|'fallback'} [args.pendingMode]
 * @param {() => Promise<{rows: object[], asOf: string, sslVerified: boolean}>} [args.directorySource]  icku HR directory; defaults to the database when configured and `source` is not overridden
 */
export async function runSync({ repo, trigger = 'manual', source, config, pendingSource, pendingToday, pendingMode, directorySource }) {
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
    // icku HR directory (optional, never blocks the sync): manager / title / status per employee number.
    let directory = null; const directoryNotes = [];
    const dirSrc = directorySource ?? (!source && directoryConfig() ? () => fetchDirectoryFromDb() : null);
    if (dirSrc) {
      try {
        const d = await dirSrc();
        directory = { index: buildDirectoryIndex(d.rows), asOf: d.asOf, sslVerified: d.sslVerified !== false, rowCount: d.rows.length, objects: d.objects || [] };
        if (!directory.sslVerified) directoryNotes.push('icku directory connection was encrypted but the server certificate was not verified (set ICKU_DB_SSL_CA).');
      } catch (err) {
        directoryNotes.push(`icku directory could not be read: ${String(err?.message || err)}. Team mapping falls back to the sheet.`);
      }
    }
    const payload = buildPayload(sheets, directory ? { ...cfg, directory: directory.index, salesIds: salesEmpNos(directory.index) } : cfg);
    for (const n of directoryNotes) payload.meta.notes.push(n);
    // Pending-tasks sheet (optional, never blocks the main sync). Read before change detection so
    // a changed task list also counts as a change.
    let pending = null;
    const sfCfg = salesforceConfig();
    const pendingSrc = pendingSource ?? (source ? null : sfCfg ? () => fetchPendingFromSalesforce(sfCfg, { today: pendingToday, tz: cfg.tz }).then((sf) => ({ salesforce: sf })) : cfg.pendingSheetId ? () => fetchPendingFromGoogle(cfg.pendingSheetId, serviceAccount()) : null);
    if (pendingSrc) {
      try {
        const ps = await pendingSrc();
        if (ps.salesforce) {
          pending = buildPendingFromSalesforce(ps.salesforce, { today: pendingToday, tz: cfg.tz, directory: directory ? directory.index : null });
          pending.notes.unshift(`Pending tasks read from Salesforce${ps.salesforce.flow ? ` (${ps.salesforce.flow} login)` : ''}: ${ps.salesforce.tasks.length} open IC/LM tasks due up to ${pending.date}, ${ps.salesforce.users.length} users.`);
          for (const n of ps.salesforce.reportNotes || []) pending.notes.push(n);
        } else {
          pending = buildPendingSnapshot(ps.sheets, { today: pendingToday, tz: cfg.tz, mode: pendingMode });
        }
      } catch (err) {
        payload.meta.notes.push(`Pending-tasks sheet could not be read: ${String(err?.message || err)}`);
      }
    }
    if (!payload.rows.length) throw new Error(`No readable daily rows found. ${payload.meta.notes.join(' ')}`);
    // Change detection: scheduled runs skip all database work when the sheet content
    // is identical to what the last snapshot was built from. Manual/CLI runs always
    // proceed (so a Refresh can force a rebuild, e.g. after a schema change).
    const contentHash = createHash('sha1').update(JSON.stringify([payload.fields, payload.rows, payload.employees, rawFull ? rawFull.rows.length : 0, pending ? [pending.date, pending.rows] : null, directory ? directory.rowCount : null])).digest('hex');
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
    const employees = payload.employees.map((e) => ({ id: e.id, name: e.name, manager: e.manager || null, tags: e.tags, team: e.team || null, status: e.status || null, title: e.title || null, department: e.department || null, location: e.location || null, joined_on: e.joinedOn || null, mapping_source: e.mappingSource || null, updated_at: syncedAt }));
    await repo.upsertEmployees(employees);
    const currentLogDates = new Set(payload.meta.callLogDates ?? []);
    // Days the database already holds as call-log days stay call-log days: the helper's
    // summary never overwrites a day that was built from the call log.
    const retainedLogDates = new Set(typeof repo.listCallLogDates === 'function' ? await repo.listCallLogDates() : []);
    // Archived days whose rows were not built from the call log are rebuilt from the archive.
    let rebuilt = [];
    try {
      rebuilt = await rebuildFromArchives({ repo, cfg, syncedAt, helperEmpIds: payload.salesEmpIds || payload.knownEmpIds || payload.helperEmpIds, haveDates: retainedLogDates, skipDates: currentLogDates });
      for (const d of rebuilt) retainedLogDates.add(d);
    } catch (err) {
      payload.meta.notes.push(`Rebuild from the call-log archive failed: ${String(err?.message || err)}`);
    }
    const rows = activityRows(payload, syncedAt).filter((r) => r.source === 'call-log' || !retainedLogDates.has(r.date));
    const { withBands, withoutBands } = splitByBands(rows);
    if (withoutBands.length) await repo.upsertActivity(withoutBands);
    if (withBands.length) await repo.upsertActivity(withBands);
    // Helper days are complete records, and so is each day of the current call log.
    const completeDates = (payload.meta.authoritativeDates ?? []).filter((d) => !retainedLogDates.has(d)).concat([...currentLogDates]);
    await repo.deleteStale(syncedAt, completeDates);
    // Archive the call-level rows for each date currently in the rotating tab.
    let archived = { dates: [], rows: 0 };
    try {
      archived = await archiveCallLog({ repo, rawFull, tz: cfg.tz, syncedAt });
    } catch (err) {
      // Archiving must never block the dashboard data; surface it in the notes instead.
      payload.meta.notes.push(`Call-log archive failed: ${String(err?.message || err)}`);
    }
    // Rows stored on earlier runs for people icku places outside the sales department are left out of the served data.
    const nonSales = new Set(payload.nonSalesEmpIds || []);
    const dbRows = (await repo.listActivity()).filter((r) => !nonSales.has(r.emp_id));
    // The served payload is built from the database, which retains call-log days
    // the sheet has since overwritten.
    const final = assemblePayload(payload, dbRows, await repo.listEmployees());
    final.pending = await storePendingSnapshot({ repo, pending, notes: final.meta.notes });
    if (directory) final.directory = { asOf: directory.asOf, sslVerified: directory.sslVerified, rows: directoryTeamRows(directory.index, final.employees.map((e) => e.id)), objects: directory.objects };
    final.meta.archivedDates = archived.dates;
    final.meta.rebuiltDates = rebuilt;
    // Unknown Emp Codes over the last two archived call-log days (the current sheet day is archived above).
    try {
      const unknown = await unknownFromArchives({ repo, cfg, knownIds: payload.knownEmpIds, helperManagers: payload.helperManagers, managerNames: [...new Set(final.employees.map((e) => e.manager).filter(Boolean))] });
      if (unknown && unknown.dates.length) { final.meta.callLogUnknown = unknown.rows; final.meta.callLogUnknownDates = unknown.dates; }
    } catch (err) {
      final.meta.notes.push(`Unknown Emp Code list could not be read from the archive: ${String(err?.message || err)}`);
    }
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

/**
 * Save today's pending-tasks snapshot (replacing any earlier one for the same day) and return
 * what the dashboard shows: today's tuples plus a 45-day team-level history. When the sheet
 * could not be read this run, the last stored day is served instead.
 */
async function storePendingSnapshot({ repo, pending, notes }) {
  if (typeof repo.replacePendingDay !== 'function') return null;
  const historyFrom = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
  const toTuples = (rows) => rows.map((r) => [r.source, r.team, r.owner, r.subject, r.bucket, r.kind || 'owner', r.count]);
  try {
    if (pending) {
      const rows = pending.rows.map(([source, team, owner, subject, bucket, kind, count]) => ({ date: pending.date, source, team, owner, subject, bucket, kind, count }));
      await repo.replacePendingDay(pending.date, rows, pendingTeamTotals(pending));
      const history = await repo.listPendingHistory(historyFrom);
      return { date: pending.date, asOf: pending.asOf, origin: pending.origin || 'sheet', sources: pending.sources, subjects: pending.subjects, rows: pending.rows, users: pending.users ?? [], history, notes: pending.notes, stats: pending.stats };
    }
    const date = await repo.getPendingLatestDate();
    if (!date) return null;
    const rows = await repo.listPendingRows(date);
    const subjects = [...new Set(rows.map((r) => r.subject))].sort();
    const history = await repo.listPendingHistory(historyFrom);
    return { date, asOf: null, sources: ['IC', 'LM'], subjects, rows: toTuples(rows), history, notes: ['Showing the last stored snapshot; the sheet could not be read this run.'], stats: {} };
  } catch (err) {
    notes.push(`Pending-tasks snapshot could not be stored: ${String(err?.message || err)}`);
    return null;
  }
}

const COLUMN_TO_FIELD = { dialed: 'dialed', dialed_connected: 'dialedConnected', talk_time_dialed: 'talkTimeDialed', incoming: 'incoming', incoming_connected: 'incomingConnected', talk_time_incoming: 'talkTimeIncoming', not_connected: 'notConnected', band_0_2: 'band02', band_2_4: 'band24', band_4_plus: 'band4p', tt_band_0_2: 'ttBand02', tt_band_2_4: 'ttBand24', tt_band_4_plus: 'ttBand4p', unique_connected: 'uniqueConnected', uq_band_0_2: 'uqBand02', uq_band_2_4: 'uqBand24', uq_band_4_plus: 'uqBand4p', missed: 'missed', rejected: 'rejected' };
const CALL_LOG_FIELD_KEYS = ['band02', 'band24', 'band4p', 'ttBand02', 'ttBand24', 'ttBand4p', 'uniqueConnected', 'uqBand02', 'uqBand24', 'uqBand4p', 'missed', 'rejected'];
const BAND_FIELDS = [
  { key: 'band02', label: 'Calls 0-2 min', concept: 'band02', kind: 'count' },
  { key: 'band24', label: 'Calls 2-4 min', concept: 'band24', kind: 'count' },
  { key: 'band4p', label: 'Calls over 4 min', concept: 'band4p', kind: 'count' },
  { key: 'ttBand02', label: 'Talk time 0-2 min calls', concept: 'ttBand02', kind: 'seconds' },
  { key: 'ttBand24', label: 'Talk time 2-4 min calls', concept: 'ttBand24', kind: 'seconds' },
  { key: 'ttBand4p', label: 'Talk time over 4 min calls', concept: 'ttBand4p', kind: 'seconds' },
  { key: 'uniqueConnected', label: 'Unique Connected', concept: 'uniqueConnected', kind: 'count' },
  { key: 'uqBand02', label: 'Unique connected 0-2 min', concept: 'uqBand02', kind: 'count' },
  { key: 'uqBand24', label: 'Unique connected 2-4 min', concept: 'uqBand24', kind: 'count' },
  { key: 'uqBand4p', label: 'Unique connected over 4 min', concept: 'uqBand4p', kind: 'count' },
  { key: 'missed', label: 'Missed Calls', concept: 'missed', kind: 'count' },
  { key: 'rejected', label: 'Rejected Calls', concept: 'rejected', kind: 'count' },
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
      out.push(CALL_LOG_FIELD_KEYS.includes(f.key) ? (v == null ? null : Number(v) || 0) : Number(v ?? 0) || 0);
    }
    for (const d of dimFields) out.push((r.dims && r.dims[d.key]) || '');
    rows.push(out);
    if (!minDate || date < minDate) minDate = date;
    if (!maxDate || date > maxDate) maxDate = date;
    if (!sheetDates.has(date)) retainedDays.add(date);
  }
  const employees = dbEmployees.map((e) => ({ id: e.id, name: e.name || e.id, manager: e.manager || '', tags: Array.isArray(e.tags) ? e.tags : [], team: e.team || '', status: e.status || '', title: e.title || '', department: e.department || '', location: e.location || '', joinedOn: e.joined_on ? String(e.joined_on).slice(0, 10) : '', mappingSource: e.mapping_source || (e.manager ? 'sheet' : 'none') }))
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
