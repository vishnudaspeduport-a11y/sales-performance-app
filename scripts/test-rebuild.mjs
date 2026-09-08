/**
 * Checks that an archived call-log day is rebuilt from its CSV when the database rows
 * for that day were not built from the call log (rows written before the call-log rules).
 *   node scripts/test-rebuild.mjs --workbook export.xlsx
 */
import assert from 'node:assert/strict';
import { createMemoryRepo } from '../server/repo.mjs';
import { runSync } from '../server/sync.mjs';
import { sheetsFromWorkbook } from '../server/workbook.mjs';
import { sheetConfig } from '../server/config.mjs';
import { arg, loadEnv } from './env.mjs';

loadEnv();
const workbook = arg('--workbook', process.env.WORKBOOK_PATH);
const repo = createMemoryRepo();
const config = sheetConfig();
const full = sheetsFromWorkbook(workbook);

// 1. normal sync → the call-log day is stored as a call-log day and archived
await runSync({ repo, trigger: 'selftest', source: async () => full, config });
const sepRows = [...repo.state.activity.values()].filter((r) => r.date === '2026-09-04');
assert.ok(sepRows.length > 0 && sepRows.every((r) => r.source === 'call-log' && r.band_0_2 != null && r.missed != null), 'call-log rows stored by the sync');
const expected = {
  rows: sepRows.length,
  calls: sepRows.reduce((s, r) => s + r.dialed + r.incoming, 0),
  connected: sepRows.reduce((s, r) => s + r.dialed_connected + r.incoming_connected, 0),
  unique: sepRows.reduce((s, r) => s + r.unique_connected, 0),
  bands: sepRows.reduce((s, r) => s + r.band_0_2 + r.band_2_4 + r.band_4_plus, 0),
};
assert.equal(expected.connected, expected.bands, 'every connected call sits in exactly one band');

// 2. simulate rows written before the call-log rules (source = helper, wrong totals) and sync
//    with a source that no longer has the call log (tab rotated / empty)
for (const r of sepRows) { r.source = 'helper'; r.dialed = 1; r.dialed_connected = 0; r.unique_connected = null; r.missed = null; }
const rotated = { sheets: { ...full.sheets, 'Raw data': [] }, sheetNames: full.sheetNames, rawFull: null };
const result = await runSync({ repo, trigger: 'selftest', source: async () => rotated, config });
const after = [...repo.state.activity.values()].filter((r) => r.date === '2026-09-04');
assert.equal(after.length, expected.rows, 'same rows after the rebuild');
assert.ok(after.every((r) => r.source === 'call-log'), 'rows rebuilt from the archive are call-log rows');
const got = {
  calls: after.reduce((s, r) => s + r.dialed + r.incoming, 0),
  connected: after.reduce((s, r) => s + r.dialed_connected + r.incoming_connected, 0),
  unique: after.reduce((s, r) => s + r.unique_connected, 0),
};
assert.deepEqual(got, { calls: expected.calls, connected: expected.connected, unique: expected.unique }, 'rebuilt totals match the original call-log totals');
const snap = await repo.getLatestSnapshot();
assert.ok(snap.payload.fields.some((f) => f.key === 'missed'), 'call-log fields present in payload even without a call log this sync');
assert.deepEqual(snap.payload.meta.rebuiltDates, ['2026-09-04']);
console.log(`rebuild OK — ${after.length} rows for 2026-09-04: ${got.calls} calls, ${got.connected} connected, ${got.unique} unique; sync rows ${result.row_count}`);

// 3. a later sync must not let the helper overwrite the call-log day
await runSync({ repo, trigger: 'manual', source: async () => rotated, config });
const again = [...repo.state.activity.values()].filter((r) => r.date === '2026-09-04');
assert.equal(again.reduce((s, r) => s + r.dialed + r.incoming, 0), expected.calls, 'call-log day retained on the next sync');

// 4. change detection: a scheduled run with identical sheet content skips database work
const before = repo.state.runs.length;
const skipped = await runSync({ repo, trigger: 'scheduled', source: async () => rotated, config });
assert.equal(skipped.unchanged, true, 'unchanged sheet is skipped on a scheduled run');
const forced = await runSync({ repo, trigger: 'manual', source: async () => rotated, config });
assert.equal(forced.unchanged, undefined, 'manual run always rebuilds');
assert.equal(repo.state.runs.length, before + 2);
console.log('change detection OK — scheduled run skipped, manual run rebuilt');
