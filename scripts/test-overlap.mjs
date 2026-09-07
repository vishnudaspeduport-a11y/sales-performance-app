// Overlap check: the call log covers a day the helper already has → helper totals kept,
// call-log detail (bands, tt bands, unique) attached to the same rows.
import assert from 'node:assert/strict';
import { buildPayload } from '../server/transform.mjs';
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
console.log('baseline mode', base.meta.sourceMode, 'callLogDates', base.meta.callLogDates);

// shift the call log back by one day so it lands on a day the helper already has
const helperDay = base.meta.authoritativeDates[base.meta.authoritativeDates.length - 1];
const shift = Math.round((Date.parse(helperDay) - Date.parse(rawDate)) / 86400000);
const shifted = raw.map((r, i) => (i === 0 ? r : r.map((v, c) => (c === dateCol ? (typeof v === 'number' ? v + shift : v) : v))));
const p = buildPayload({ ...sheets, 'Raw data': shifted }, cfg);
const f = fi(p);
console.log('overlap mode', p.meta.sourceMode, 'callLogDates', p.meta.callLogDates, 'notes:', p.meta.notes.slice(-1)[0]);
assert.equal(p.meta.sourceMode, 'helper-raw+raw-log');
assert.deepEqual(p.meta.callLogDates, [helperDay]);
assert.ok(p.meta.authoritativeDates.includes(helperDay), 'day stays authoritative (helper)');

const rowsDay = p.rows.filter((r) => r[f.date] === helperDay);
const baseDay = base.rows.filter((r) => r[b.date] === helperDay);
assert.equal(rowsDay.length, baseDay.length, 'same number of rows for the day as helper-only');
const withBands = rowsDay.filter((r) => r[f.band02] != null);
const withTT = rowsDay.filter((r) => r[f.ttBand02] != null);
const withUq = rowsDay.filter((r) => r[f.uniqueConnected] != null);
console.log(`rows ${rowsDay.length}, with bands ${withBands.length}, with tt ${withTT.length}, with unique ${withUq.length}`);
assert.ok(withBands.length > 0 && withTT.length === withBands.length && withUq.length === withBands.length);
// helper totals untouched
const sum = (rows, i) => rows.reduce((s, r) => s + (r[i] || 0), 0);
assert.equal(sum(rowsDay, f.dialed), sum(baseDay, b.dialed));
assert.equal(sum(rowsDay, f.dialedConnected), sum(baseDay, b.dialedConnected));
assert.equal(sum(rowsDay, f.talkTimeDialed), sum(baseDay, b.talkTimeDialed));
// no bands on other helper days
const other = p.rows.filter((r) => r[f.date] !== helperDay && r[f.band02] != null);
assert.equal(other.length, 0, 'other days have no call detail');
console.log('overlap OK');
