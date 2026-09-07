/**
 * Checks that duration bands are rebuilt from an archived CSV when the database
 * rows have none (e.g. days archived before the band columns existed).
 *   node scripts/test-backfill.mjs --workbook export.xlsx
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

// 1. normal sync → bands present and archive stored
await runSync({ repo, trigger: 'selftest', source: async () => full, config });
const sepRows = [...repo.state.activity.values()].filter((r) => r.date === '2026-09-04');
assert.ok(sepRows.length > 0 && sepRows.every((r) => r.band_0_2 != null), 'bands stored by the sync');
const expected = sepRows.reduce((s, r) => s + r.band_0_2 + r.band_2_4 + r.band_4_plus, 0);

// 2. wipe the bands (simulating rows written before the columns existed) and sync
//    with a source that no longer has the call log (tab rotated / empty)
for (const r of sepRows) { r.band_0_2 = null; r.band_2_4 = null; r.band_4_plus = null; }
const rotated = { sheets: { ...full.sheets, 'Raw data': [] }, sheetNames: full.sheetNames, rawFull: null };
const result = await runSync({ repo, trigger: 'selftest', source: async () => rotated, config });
const after = [...repo.state.activity.values()].filter((r) => r.date === '2026-09-04');
assert.ok(after.every((r) => r.band_0_2 != null), 'bands restored from the archive');
const restored = after.reduce((s, r) => s + r.band_0_2 + r.band_2_4 + r.band_4_plus, 0);
assert.equal(restored, expected, 'restored band totals match the original');
const snap = await repo.getLatestSnapshot();
assert.ok(snap.payload.fields.some((f) => f.key === 'band02'), 'band fields present in payload even without a call log this sync');
assert.deepEqual(snap.payload.meta.bandBackfilledDates, ['2026-09-04']);
console.log(`backfill OK — ${after.length} rows for 2026-09-04, ${restored} banded calls restored; sync rows ${result.row_count}`);
