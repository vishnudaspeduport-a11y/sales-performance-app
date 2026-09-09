/**
 * Local API that mirrors the Netlify functions on http://localhost:8787.
 *
 *   node scripts/dev-api.mjs --workbook export.xlsx   # no cloud needed: in-memory DB + xlsx source
 *   node scripts/dev-api.mjs                          # real Supabase + Google Sheet (needs .env)
 *
 * The Vite dev server proxies /api to this port.
 */
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleArchiveFile, handleArchives, handleData, handleHealth, handleRefresh, json } from '../server/api.mjs';
import { createMemoryRepo, createSupabaseRepo } from '../server/repo.mjs';
import { runSync } from '../server/sync.mjs';
import { sheetsFromWorkbook } from '../server/workbook.mjs';
import { sheetConfig } from '../server/config.mjs';
import { arg, loadEnv } from './env.mjs';

loadEnv();
const PORT = Number(arg('--port', process.env.PORT || 8787));
const workbook = arg('--workbook', process.env.WORKBOOK_PATH || '');
const mock = !!workbook;
// --static also serves the production build from dist/ (like Netlify would)
const serveStatic = process.argv.includes('--static');
const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const repo = mock ? createMemoryRepo() : createSupabaseRepo();
const config = sheetConfig();
const source = mock ? async () => sheetsFromWorkbook(workbook) : undefined;
const sync = (trigger) => runSync({ repo, trigger, source, config });

if (mock) {
  console.log(`Loading ${workbook} …`);
  const r = await sync('cli');
  console.log('Initial sync:', JSON.stringify(r));
}

http.createServer(async (req, res) => {
  const request = new Request(`http://localhost:${PORT}${req.url}`, { method: req.method, headers: req.headers });
  let response;
  try {
    const path = new URL(request.url).pathname;
    if (path === '/api/data') response = await handleData({ repo, req: request, runInline: () => sync('manual') });
    else if (path === '/api/health') response = await handleHealth({ repo });
    else if (path === '/api/refresh' && req.method === 'POST') response = await handleRefresh({ repo, req: request, runInline: () => sync('manual') });
    else if (path === '/api/archives') response = await handleArchives({ repo });
    else if (path.startsWith('/api/archives/')) response = await handleArchiveFile({ repo, req: request, date: decodeURIComponent(path.slice('/api/archives/'.length)) });
    else if (path === '/api/sync' && req.method === 'POST') { const r = await sync('manual'); response = json(r); }
    else if (serveStatic && !path.startsWith('/api/')) {
      let file = normalize(join(DIST, path === '/' ? 'index.html' : path));
      if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
      if (!existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('dist/ not found — run `npm run build` first.'); return; }
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      createReadStream(file).on('error', () => res.end()).pipe(res);
      return;
    }
    else response = json({ error: 'not found' }, { status: 404 });
  } catch (err) {
    response = json({ error: 'Request failed', detail: String(err?.message || err) }, { status: 500 });
  }
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(PORT, () => console.log(`Dev API on http://localhost:${PORT}/api/data  (${mock ? 'mock: in-memory DB from workbook' : 'live: Supabase + Google Sheets'})`));
