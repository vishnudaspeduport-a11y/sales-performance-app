/**
 * Figures "by 4 PM" per executive per day, for the Performance page:
 *   talk    talk time (seconds) of the calls that started before the cut-off, outgoing and incoming
 *   long    connected calls of three minutes or more that started before the cut-off
 * They are worked out from the call log, which carries the time of every call; the daily totals in
 * the database do not. Like the unique-number counts they live in one small JSON file in the
 * archive bucket (stats/cutoff-16.json): each sync recounts the days in the sheet's call log and
 * fills in archived days that are missing. A past day is never replaced by a count built from
 * fewer call rows than the one already stored.
 *
 * The same pass notes each executive's own phone number (the "Employee Number" column). Those go
 * to a separate file (stats/employee-phones.json) that only the admin endpoint reads; they are
 * never part of the data served to the dashboard.
 */
import { gunzipSync } from 'node:zlib';
import { parseCsv } from './archive.mjs';
import { RAW_LOG_ALIASES, mapHeaders, normEmpId, parseDateCell, toSeconds } from './transform.mjs';

export const CUTOFF_STAT = 'cutoff-16';
export const PHONES_STAT = 'employee-phones';
export const CUTOFF_MINUTES = 16 * 60;
export const LONG_CALL_SECONDS = 180;

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
const PHONE_HEADERS = new Set(['employee number', 'emp number', 'emp. number', 'employee no', 'employee phone', 'emp. phone', 'employee mobile']);

/** Call time in a sheet cell → minutes after midnight: "1:37 PM", "13:37", "13:37:05" or a fraction of a day. */
export function parseTimeCell(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && isFinite(v)) { const f = v - Math.floor(v); return Math.floor(f * 1440 + 1e-6); }
  const s = String(v).trim();
  const m = /(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([ap])\.?\s*m?\.?/i.exec(s) || /(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?/.exec(s);
  if (!m) { const n = Number(s); return isFinite(n) && n >= 0 && n < 1 ? Math.floor(n * 1440 + 1e-6) : null; }
  let h = Number(m[1]); const min = Number(m[2]);
  const ap = m[4] ? m[4].toLowerCase() : '';
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * @param {any[][]} table  call-log rows with the header row first (within the first ten rows)
 * @returns {{ days: Map<string, { rows: number, untimed: number, emp: Record<string, [number, number]> }>, phones: Record<string, string> }}
 */
export function cutoffFromTable(table, tz = 'Asia/Kolkata', cutoff = CUTOFF_MINUTES) {
  const days = new Map(); const phones = {};
  let headerIdx = -1; let map = null;
  for (let r = 0; r < Math.min(table.length, 10); r++) {
    const m = mapHeaders(table[r], RAW_LOG_ALIASES);
    if (m.type != null && m.date != null && m.empId != null) { headerIdx = r; map = m; break; }
  }
  if (!map || map.duration == null || map.time == null) return { days, phones };
  const phoneCol = table[headerIdx].findIndex((h) => PHONE_HEADERS.has(norm(h)));
  const seen = new Set();
  for (let i = headerIdx + 1; i < table.length; i++) {
    const row = table[i];
    const type = norm(row[map.type]);
    if (!type) continue;
    const date = parseDateCell(row[map.date], tz);
    const id = normEmpId(row[map.empId]);
    if (!date || !id) continue;
    const sig = row.join('');
    if (seen.has(sig)) continue;
    seen.add(sig);
    if (phoneCol >= 0) { const p = String(row[phoneCol] == null ? '' : row[phoneCol]).replace(/\D/g, ''); if (p.length >= 8) phones[id] = p; }
    let day = days.get(date);
    if (!day) { day = { rows: 0, untimed: 0, emp: {} }; days.set(date, day); }
    day.rows++;
    const secs = toSeconds(row[map.duration], 'seconds');
    const e = (day.emp[id] ??= [0, 0]);
    if (!(secs > 0)) continue;
    const at = parseTimeCell(row[map.time]);
    if (at == null) { day.untimed++; continue; }
    if (at >= cutoff) continue;
    e[0] += secs;
    if (secs >= LONG_CALL_SECONDS) e[1]++;
  }
  return { days, phones };
}

/**
 * Bring the stored figures up to date and return them.
 * @returns {Promise<{ store: Record<string, {rows: number, untimed: number, emp: Record<string, number[]>}>, updated: string[], filled: string[], kept: string[], phones: number }|null>}
 */
export async function maintainCutoff({ repo, rawFull, tz = 'Asia/Kolkata', backfill = 45 }) {
  if (typeof repo.downloadStat !== 'function' || typeof repo.uploadStat !== 'function') return null;
  const read = async (name) => { const saved = await repo.downloadStat(name); if (!saved) return {}; try { const j = JSON.parse(saved.toString('utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; } };
  const store = await read(CUTOFF_STAT);
  const savedPhones = await read(PHONES_STAT);
  const phones = { ...(savedPhones.phones && typeof savedPhones.phones === 'object' ? savedPhones.phones : {}) };
  const phonesBefore = JSON.stringify(phones);
  const updated = []; const filled = []; const kept = [];
  if (rawFull && rawFull.rows && rawFull.rows.length) {
    const current = cutoffFromTable([rawFull.header, ...rawFull.rows], tz);
    Object.assign(phones, current.phones);
    const latest = [...current.days.keys()].sort().pop();
    for (const [date, day] of current.days) {
      const old = store[date];
      if (date !== latest && old && day.rows < old.rows) { kept.push(date); continue; }
      store[date] = day; updated.push(date);
    }
  }
  if (typeof repo.listArchives === 'function' && typeof repo.downloadArchive === 'function') {
    const dates = (await repo.listArchives()).map((a) => (typeof a.date === 'string' ? a.date.slice(0, 10) : String(a.date)));
    const todo = dates.filter((d) => !store[d]).sort().reverse().slice(0, backfill);
    for (const date of todo) {
      const gz = await repo.downloadArchive(date);
      if (!gz) continue;
      const got = cutoffFromTable(parseCsv(gunzipSync(gz).toString('utf8')), tz);
      for (const [id, p] of Object.entries(got.phones)) if (!phones[id]) phones[id] = p;
      const day = got.days.get(date);
      if (day) { store[date] = day; filled.push(date); }
    }
  }
  if (updated.length || filled.length) await repo.uploadStat(CUTOFF_STAT, Buffer.from(JSON.stringify(store), 'utf8'));
  if (JSON.stringify(phones) !== phonesBefore) await repo.uploadStat(PHONES_STAT, Buffer.from(JSON.stringify({ phones, updatedAt: new Date().toISOString() }), 'utf8'));
  return { store, updated, filled, kept, phones: Object.keys(phones).length };
}

/**
 * The form served to the dashboard:
 *   { at: "16:00", longSeconds: 180, dates: [...], rows: [[dateIndex, empId, talkSeconds, longCalls]] }
 * `keep` limits the employees (sales department), `drop` removes some (outside sales). No phone numbers.
 */
export function encodeCutoff(store, { keep = null, drop = null } = {}) {
  const dates = Object.keys(store || {}).sort();
  if (!dates.length) return null;
  const rows = [];
  dates.forEach((date, di) => {
    for (const [id, c] of Object.entries(store[date].emp || {})) {
      if (keep && !keep[id]) continue;
      if (drop && drop.has(id)) continue;
      rows.push([di, id, Math.round(c[0] || 0), c[1] || 0]);
    }
  });
  return { at: '16:00', longSeconds: LONG_CALL_SECONDS, dates, rows };
}
