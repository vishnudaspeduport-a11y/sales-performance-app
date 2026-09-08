// Overlap check: when the call log covers a day the helper already has, that day is built
// from the call log alone (every call row counts), limited to executives the helper lists.
import assert from 'node:assert/strict';
import { buildFromCallLog, buildPayload } from '../server/transform.mjs';
import { sheetsFromWorkbook } from '../server/workbook.mjs';
import { sheetConfig } from '../server/config.mjs';
import { arg, loadEnv } from './env.mjs';

loadEnv();
const wb = arg('--workbook', process.env.WORKBOOK_PATH);
if (!wb) { console.error('Pass --workbook <export.xlsx>'); process.exit(1); }
const cfg = sheetConfig();
const { sheets } = sheetsFromWorkbook(wb);
const raw = sheets['Raw data'];
const dateCol = raw[0].findIndex((h) => String(h).toLowerCase().trim() === 'call date');

const base = buildPayload(sheets, cfg);
const fi = (p) => Object.fromEntries(p.fields.map((f, i) => [f.key, i]));
const b = fi(base);
const rawDate = base.meta.callLogDates[0];
console.log('baseline mode', base.meta.sourceMode, 'callLogDates', base.meta.callLogDates, '| helper header ids', base.helperEmpIds.length);

// shift the call log onto a day the helper already has
const helperDay = base.meta.authoritativeDates[base.meta.authoritativeDates.length - 1];
const shift = Math.round((Date.parse(helperDay) - Date.parse(rawDate)) / 86400000);
const shifted = raw.map((r, i) => (i === 0 ? r : r.map((v, c) => (c === dateCol ? (typeof v === 'number' ? v + shift : v) : v))));
const p = buildPayload({ ...sheets, 'Raw data': shifted }, cfg);
const f = fi(p);
console.log('overlap mode', p.meta.sourceMode, 'callLogDates', p.meta.callLogDates, '\nnote:', p.meta.notes.slice(-1)[0]);
assert.equal(p.meta.sourceMode, 'helper-raw+raw-log');
assert.deepEqual(p.meta.callLogDates, [helperDay]);
assert.ok(!p.meta.authoritativeDates.includes(helperDay), 'the call-log day is no longer a helper day');

// expected: call-log records for that day, limited to executives in the helper header
const scope = new Set(base.helperEmpIds);
const built = buildFromCallLog(shifted, cfg.tz, []);
const expected = built.store.order.map((k) => built.store.byKey[k]).filter((r) => r.date === helperDay && scope.has(r.empId));
const rowsDay = p.rows.filter((r) => r[f.date] === helperDay);
const sum = (rows, i) => rows.reduce((s, r) => s + (r[i] || 0), 0);
assert.equal(rowsDay.length, expected.length, 'one row per executive in the helper header with calls that day');
assert.equal(sum(rowsDay, f.dialed) + sum(rowsDay, f.incoming), expected.reduce((s, r) => s + r.dialed + r.incoming, 0), 'total calls = call rows');
assert.equal(sum(rowsDay, f.dialedConnected) + sum(rowsDay, f.incomingConnected), expected.reduce((s, r) => s + r.dialedConnected + r.incomingConnected, 0), 'connected = rows with a duration');
assert.equal(sum(rowsDay, f.uniqueConnected), expected.reduce((s, r) => s + r.uniqueConnected, 0), 'unique connected carried over');
assert.equal(sum(rowsDay, f.missed) + sum(rowsDay, f.rejected), expected.reduce((s, r) => s + r.missed + r.rejected, 0), 'missed/rejected carried over');
assert.ok(rowsDay.every((r) => r[f.band02] != null && r[f.missed] != null), 'every row on the day carries call detail');
const dropped = built.store.order.map((k) => built.store.byKey[k]).filter((r) => r.date === helperDay && !scope.has(r.empId)).length;
assert.ok(dropped > 0 && !rowsDay.some((r) => !scope.has(r[f.empId])), 'people not in the helper header are dropped');
// other helper days untouched
const otherBase = base.rows.filter((r) => r[b.date] !== helperDay && r[b.date] !== rawDate).length;
const otherNow = p.rows.filter((r) => r[f.date] !== helperDay).length;
assert.equal(otherNow, otherBase, 'other helper days unchanged');
assert.equal(p.rows.filter((r) => r[f.date] !== helperDay && r[f.band02] != null).length, 0, 'other days have no call detail');
console.log(`overlap OK — ${rowsDay.length} executives on ${helperDay}, ${dropped} employee-days outside the helper dropped`);
