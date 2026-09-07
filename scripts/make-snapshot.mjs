/**
 * Builds a self-contained preview page: the app plus an embedded copy of a data
 * payload, so a change can be reviewed as a single HTML file before deploying.
 *
 *   node scripts/make-snapshot.mjs --payload payload.json --out preview.html
 *   (run `vite build --mode snapshot` first, or pass --build to do it here)
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distFile = resolve(root, 'dist-snapshot', 'index.html');

if (args.includes('--build') || !existsSync(distFile)) {
  execSync('node node_modules/vite/bin/vite.js build --mode snapshot', { cwd: root, stdio: 'inherit' });
}
const html = readFileSync(distFile, 'utf8');
const payload = JSON.parse(readFileSync(resolve(opt('--payload')), 'utf8'));
delete payload.meta.refreshQueued;
const safeJson = JSON.stringify(payload).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--');
const out = html.replace('<head>', `<head>\n<script>window.__SALES_DASHBOARD_DATA__=${safeJson};</script>`);
const target = resolve(opt('--out', 'preview.html'));
writeFileSync(target, out);
console.log(`Wrote ${target} (${Math.round(out.length / 1024)} KB, ${payload.rows.length} rows, ${payload.employees.length} employees, data to ${payload.meta.dateRange?.to})`);
