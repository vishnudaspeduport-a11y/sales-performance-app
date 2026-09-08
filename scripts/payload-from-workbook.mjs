/**
 * Produce a dashboard payload JSON from an .xlsx export using the in-memory
 * repo (exactly what /api/data would serve after a sync of that workbook).
 * Archived call-log CSVs can be seeded so retained days are rebuilt from them.
 *   node scripts/payload-from-workbook.mjs --workbook export.xlsx --out payload.json [--archive call-log-2026-09-04.csv,...]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { gzipSync } from 'node:zlib';
import { parseCsv } from '../server/archive.mjs';
import { createMemoryRepo } from '../server/repo.mjs';
import { runSync } from '../server/sync.mjs';
import { sheetsFromWorkbook } from '../server/workbook.mjs';
import { sheetConfig } from '../server/config.mjs';
import { arg, loadEnv } from './env.mjs';

loadEnv();
const workbook = arg('--workbook', process.env.WORKBOOK_PATH);
const out = arg('--out', 'payload.json');
const archives = (arg('--archive', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const repo = createMemoryRepo();

for (const file of archives) {
  const m = /(\d{4}-\d{2}-\d{2})/.exec(basename(file));
  if (!m) throw new Error(`Archive file name must contain the call date (YYYY-MM-DD): ${file}`);
  const text = readFileSync(file, 'utf8');
  const table = parseCsv(text);
  await repo.uploadArchive({ date: m[1], gz: gzipSync(Buffer.from(text, 'utf8')), rowCount: table.length - 1, bytes: 0, csvBytes: Buffer.byteLength(text), columns: table[0], syncedAt: new Date().toISOString() });
  console.log(`seeded archive ${m[1]}: ${table.length - 1} rows`);
}

const result = await runSync({ repo, trigger: 'cli', source: async () => sheetsFromWorkbook(workbook), config: sheetConfig() });
const snap = await repo.getLatestSnapshot();
writeFileSync(out, JSON.stringify(snap.payload));
console.log(`Wrote ${out}: ${snap.payload.rows.length} rows, ${snap.payload.employees.length} employees, mode ${result.source_mode}, call-log days ${JSON.stringify(snap.payload.meta.callLogDates)}, rebuilt ${JSON.stringify(snap.payload.meta.rebuiltDates)}`);
console.log(`notes: ${snap.payload.meta.notes.join(' | ')}`);
