/**
 * Unique-number counts per executive per day, the way the Input DB sheet counts them:
 *   dialed             distinct numbers called (Outgoing)
 *   dialedConnected    distinct numbers called that answered (Outgoing with a duration)
 *   incoming           distinct numbers that called in (Incoming, Missed or Rejected)
 *   incomingConnected  distinct numbers that called in and were answered
 * A number dialed three times in a day counts once. Only the counts are kept; the numbers
 * themselves never leave this module.
 *
 * The counts live in one small JSON file in the archive bucket (stats/unique-numbers.json), so no
 * database column is needed. Each sync recounts the days in the sheet's call log and fills in any
 * archived day that is missing. A past day is never replaced by a count built from fewer call rows
 * than the one already stored, so leftover rows of an old day in the sheet cannot damage it.
 */
import { gunzipSync } from 'node:zlib';
import { parseCsv } from './archive.mjs';
import { RAW_LOG_ALIASES, mapHeaders, normEmpId, parseDateCell, toSeconds } from './transform.mjs';

export const UNIQUE_STAT = 'unique-numbers';
const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();

/**
 * @param {any[][]} table  call-log rows with the header row first (within the first ten rows)
 * @returns {Map<string, { rows: number, emp: Record<string, [number, number, number, number]> }>} by date
 */
export function uniqueCountsFromTable(table, tz = 'Asia/Kolkata') {
  const out = new Map();
  let headerIdx = -1; let map = null;
  for (let r = 0; r < Math.min(table.length, 10); r++) {
    const m = mapHeaders(table[r], RAW_LOG_ALIASES);
    if (m.type != null && m.date != null && m.empId != null) { headerIdx = r; map = m; break; }
  }
  if (!map || map.toNumber == null) return out;
  const sets = new Map();
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
    const out_ = type.startsWith('out') || type === 'dialed' || type === 'dialled';
    const in_ = type.startsWith('in') || type === 'missed' || type === 'not connected' || type === 'rejected';
    if (!out_ && !in_) continue;
    let day = sets.get(date);
    if (!day) { day = { rows: 0, emp: new Map() }; sets.set(date, day); }
    day.rows++;
    const num = String(row[map.toNumber] == null ? '' : row[map.toNumber]).replace(/\D/g, '');
    if (!num) continue;
    let e = day.emp.get(id);
    if (!e) { e = [new Set(), new Set(), new Set(), new Set()]; day.emp.set(id, e); }
    const connected = map.duration != null && toSeconds(row[map.duration], 'seconds') > 0;
    if (out_) { e[0].add(num); if (connected) e[1].add(num); }
    else { e[2].add(num); if (connected) e[3].add(num); }
  }
  for (const [date, day] of sets) {
    const emp = {};
    for (const [id, e] of day.emp) emp[id] = [e[0].size, e[1].size, e[2].size, e[3].size];
    out.set(date, { rows: day.rows, emp });
  }
  return out;
}

/**
 * Bring the stored counts up to date and return them.
 * @param {object} args
 * @param {object} args.repo  needs downloadStat / uploadStat; listArchives / downloadArchive for the back-fill
 * @param {{header: any[], rows: any[][]}|null} args.rawFull  the sheet's call log
 * @param {number} [args.backfill]  archived days to fill in per run
 * @returns {Promise<{ store: Record<string, {rows: number, emp: Record<string, number[]>}>, updated: string[], filled: string[], kept: string[] }|null>}
 */
export async function maintainUniqueCounts({ repo, rawFull, tz = 'Asia/Kolkata', backfill = 60 }) {
  if (typeof repo.downloadStat !== 'function' || typeof repo.uploadStat !== 'function') return null;
  let store = {};
  const saved = await repo.downloadStat(UNIQUE_STAT);
  if (saved) { try { const j = JSON.parse(saved.toString('utf8')); if (j && typeof j === 'object') store = j; } catch { store = {}; } }
  const updated = []; const filled = []; const kept = [];
  if (rawFull && rawFull.rows && rawFull.rows.length) {
    const current = uniqueCountsFromTable([rawFull.header, ...rawFull.rows], tz);
    const latest = [...current.keys()].sort().pop();
    for (const [date, day] of current) {
      const old = store[date];
      // The newest day in the sheet keeps filling up. An older day is only accepted when it is new
      // here or built from at least as many call rows as the stored one.
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
      const day = uniqueCountsFromTable(parseCsv(gunzipSync(gz).toString('utf8')), tz).get(date);
      if (day) { store[date] = day; filled.push(date); }
    }
  }
  if (updated.length || filled.length) await repo.uploadStat(UNIQUE_STAT, Buffer.from(JSON.stringify(store), 'utf8'));
  return { store, updated, filled, kept };
}

/**
 * The form served to the dashboard: { dates: [...], rows: [[dateIndex, empId, dialed, dialedConnected, incoming, incomingConnected]] }.
 * `keep` limits the employees (sales department), `drop` removes some (outside sales).
 */
export function encodeUniqueCounts(store, { keep = null, drop = null } = {}) {
  const dates = Object.keys(store || {}).sort();
  if (!dates.length) return null;
  const rows = [];
  dates.forEach((date, di) => {
    for (const [id, c] of Object.entries(store[date].emp || {})) {
      if (keep && !keep[id]) continue;
      if (drop && drop.has(id)) continue;
      rows.push([di, id, c[0] || 0, c[1] || 0, c[2] || 0, c[3] || 0]);
    }
  });
  return { dates, rows };
}
