/**
 * Produce a dashboard payload JSON from an .xlsx export using the in-memory
 * repo (exactly what /api/data would serve after a sync of that workbook).
 *   node scripts/payload-from-workbook.mjs --workbook export.xlsx --out payload.json
 */
import { writeFileSync } from 'node:fs';
import { createMemoryRepo } from '../server/repo.mjs';
import { runSync } from '../server/sync.mjs';
import { sheetsFromWorkbook } from '../server/workbook.mjs';
import { sheetConfig } from '../server/config.mjs';
import { arg, loadEnv } from './env.mjs';

loadEnv();
const workbook = arg('--workbook', process.env.WORKBOOK_PATH);
const out = arg('--out', 'payload.json');
const repo = createMemoryRepo();
await runSync({ repo, trigger: 'cli', source: async () => sheetsFromWorkbook(workbook), config: sheetConfig() });
const snap = await repo.getLatestSnapshot();
writeFileSync(out, JSON.stringify(snap.payload));
console.log(`Wrote ${out}: ${snap.payload.rows.length} rows, ${snap.payload.employees.length} employees, fields ${snap.payload.fields.map((f) => f.key).join(',')}`);
