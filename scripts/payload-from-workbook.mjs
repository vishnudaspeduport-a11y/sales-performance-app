/**
 * Produce a dashboard payload JSON from an .xlsx export using the in-memory
 * repo (exactly what /api/data would serve after a sync of that workbook).
 * Archived call-log CSVs can be seeded so retained days are rebuilt from them, and an
 * export of the Pending Tasks sheet can be attached.
 *   node scripts/payload-from-workbook.mjs --workbook export.xlsx --out payload.json
 *        [--archive call-log-2026-09-04.csv,...] [--pending pending.xlsx --pending-today 2026-09-09 --pending-mode sheet|fallback]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { gzipSync } from 'node:zlib';
import { parseCsv } from '../server/archive.mjs';
import { directoryConfig, fetchDirectoryFromDb, directoryRowsFromRaw } from '../server/directory.mjs';
import { createMemoryRepo } from '../server/repo.mjs';
import { runSync } from '../server/sync.mjs';
import { sheetsFromWorkbook } from '../server/workbook.mjs';
import { sheetConfig } from '../server/config.mjs';
import { arg, loadEnv } from './env.mjs';

loadEnv();
const workbook = arg('--workbook', process.env.WORKBOOK_PATH);
const out = arg('--out', 'payload.json');
const archives = (arg('--archive', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const pendingFile = arg('--pending', '');
const repo = createMemoryRepo();

for (const file of archives) {
  const m = /(\d{4}-\d{2}-\d{2})/.exec(basename(file));
  if (!m) throw new Error(`Archive file name must contain the call date (YYYY-MM-DD): ${file}`);
  const text = readFileSync(file, 'utf8');
  const table = parseCsv(text);
  await repo.uploadArchive({ date: m[1], gz: gzipSync(Buffer.from(text, 'utf8')), rowCount: table.length - 1, bytes: 0, csvBytes: Buffer.byteLength(text), columns: table[0], syncedAt: new Date().toISOString() });
  console.log(`seeded archive ${m[1]}: ${table.length - 1} rows`);
}

const pendingSource = pendingFile ? async () => sheetsFromWorkbook(pendingFile, '__none__') : undefined;
// --directory live reads the icku directory with the ICKU_DB_* variables from .env / the environment;
// --directory <file.json> uses a saved {rows:[...]} export of it instead (previews, tests).
const dirArg = arg('--directory', '');
const directorySource = dirArg === 'live' ? () => fetchDirectoryFromDb(directoryConfig()) : dirArg ? async () => ({ rows: directoryRowsFromRaw(JSON.parse(readFileSync(dirArg, 'utf8')).rows), asOf: new Date().toISOString(), sslVerified: false }) : undefined;
const result = await runSync({
  repo, trigger: 'cli', source: async () => sheetsFromWorkbook(workbook), config: sheetConfig(),
  pendingSource, pendingToday: arg('--pending-today', undefined), pendingMode: arg('--pending-mode', 'auto'), directorySource,
});
const snap = await repo.getLatestSnapshot();
writeFileSync(out, JSON.stringify(snap.payload));
const p = snap.payload;
console.log(`Wrote ${out}: ${p.rows.length} rows, ${p.employees.length} employees, mode ${result.source_mode}, call-log days ${JSON.stringify(p.meta.callLogDates)}, rebuilt ${JSON.stringify(p.meta.rebuiltDates)}${p.pending ? `, pending ${p.pending.rows.length} tuples for ${p.pending.date}` : ''}`);
console.log(`notes: ${p.meta.notes.join(' | ')}`);
if (p.pending) console.log(`pending notes: ${p.pending.notes.join(' | ')}`);
if (p.directory) console.log(`directory: ${p.directory.rows.length} team-mapping rows as of ${p.directory.asOf}`);
