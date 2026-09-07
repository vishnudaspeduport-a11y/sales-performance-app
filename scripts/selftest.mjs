/**
 * End-to-end self-test without cloud credentials:
 * xlsx export → transform → in-memory repo → /api/data handler → shape checks.
 *   node scripts/selftest.mjs --workbook export.xlsx
 */
import assert from 'node:assert/strict';
import { handleData, handleHealth } from '../server/api.mjs';
import { createMemoryRepo } from '../server/repo.mjs';
import { runSync } from '../server/sync.mjs';
import { sheetsFromWorkbook } from '../server/workbook.mjs';
import { sheetConfig } from '../server/config.mjs';
import { arg, loadEnv } from './env.mjs';

loadEnv();
const workbook = arg('--workbook', process.env.WORKBOOK_PATH);
if (!workbook) { console.error('Pass --workbook <export.xlsx>'); process.exit(1); }

const repo = createMemoryRepo();
const config = sheetConfig();

// 1. sync
const r1 = await runSync({ repo, trigger: 'selftest', source: async () => sheetsFromWorkbook(workbook), config });
assert.equal(r1.status, 'success');
assert.ok(r1.row_count > 0, 'rows synced');
console.log('sync #1', JSON.stringify(r1));

// 2. idempotent re-sync keeps the same row count
const r2 = await runSync({ repo, trigger: 'selftest', source: async () => sheetsFromWorkbook(workbook), config });
assert.equal(r2.row_count, r1.row_count, 'second sync same rows');
assert.equal(repo.state.activity.size, r1.row_count, 'no duplicates in table');

// 3. data endpoint
const res = await handleData({ repo, req: new Request('http://localhost/api/data') });
assert.equal(res.status, 200);
assert.match(res.headers.get('cache-control'), /max-age=/);
const payload = await res.json();
assert.equal(payload.rows.length, r1.row_count);
assert.ok(payload.fields.some((f) => f.key === 'date') && payload.fields.some((f) => f.key === 'empId'));
assert.ok(payload.employees.length > 0);
for (const row of payload.rows.slice(0, 50)) assert.match(String(row[0]), /^\d{4}-\d{2}-\d{2}$/);

// 4. refresh queues (throttled right after a sync)
const res2 = await handleData({ repo, req: new Request('http://localhost/api/data?refresh=1'), runInline: async () => {} });
const p2 = await res2.json();
assert.equal(res2.headers.get('cache-control'), 'no-store');
assert.equal(typeof p2.meta.refreshQueued, 'boolean');

// 5. health
const h = await (await handleHealth({ repo })).json();
assert.equal(h.lastSync.status, 'success');

console.log(`OK — ${payload.rows.length} rows, ${payload.employees.length} employees, ${payload.meta.dateRange.from} → ${payload.meta.dateRange.to}, mode ${payload.meta.sourceMode}, payload ${(JSON.stringify(payload).length / 1024).toFixed(0)} KB`);

// 6. Retention: when the call log rotates to a new day, the previous day stays in the DB
{
  const { sheets } = sheetsFromWorkbook(workbook);
  const raw = sheets['Raw data'];
  const dateCol = raw[0].findIndex((h) => String(h).toLowerCase().trim() === 'call date');
  const rotated = raw.map((r, i) => (i === 0 ? r : r.map((v, c) => (c === dateCol ? (typeof v === 'number' ? v + 1 : v) : v))));
  const r3 = await runSync({ repo, trigger: 'selftest', source: async () => ({ sheets: { ...sheets, 'Raw data': rotated } }), config });
  const p3 = (await (await handleData({ repo, req: new Request('http://localhost/api/data') })).json());
  const dates = new Set(p3.rows.map((r) => r[0]));
  assert.ok(dates.has('2026-09-04') && dates.has('2026-09-05'), 'both the old and the new call-log day are present');
  assert.ok(p3.meta.retainedDays.includes('2026-09-04'), 'old day reported as retained');
  assert.equal(r3.row_count, p3.rows.length);
  console.log(`retention OK — ${p3.meta.retainedDays.length} retained day(s), rows ${p3.rows.length}`);
}
