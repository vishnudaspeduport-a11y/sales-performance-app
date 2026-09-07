/**
 * Google Sheets source. Reads the workbook with a service account and returns
 * { [sheetName]: values[][] } exactly like Range.getValues() would, so the
 * transform layer is shared with the local workbook source.
 */
import { JWT } from 'google-auth-library';
import { RAW_LOG_ALIASES, mapHeaders } from './transform.mjs';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

function a1Sheet(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}
function colLetter(idx0) {
  let n = idx0 + 1; let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

async function makeClient(sa) {
  const client = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  await client.authorize();
  return client;
}

async function getJson(client, url) {
  const res = await client.request({ url, retry: true });
  return res.data;
}

async function batchGet(client, sheetId, ranges) {
  const params = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
  const data = await getJson(client, `${API}/${sheetId}/values:batchGet?${params}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER&majorDimension=ROWS`);
  return (data.valueRanges || []).map((vr) => vr.values || []);
}

/**
 * The call log can be hundreds of thousands of rows; read only the columns the
 * transform needs. Column ranges stop at the last non-empty cell, so blank
 * filler rows cost nothing.
 */
async function readCallLog(client, sheetId, name) {
  const [head] = await batchGet(client, sheetId, [`${a1Sheet(name)}!1:10`]);
  let headerIdx = -1; let map = null;
  for (let r = 0; r < head.length; r++) {
    const m = mapHeaders(head[r], RAW_LOG_ALIASES);
    if (m.type != null && m.date != null && (m.empId != null || m.name != null)) { headerIdx = r; map = m; break; }
  }
  if (map == null) { const [all] = await batchGet(client, sheetId, [a1Sheet(name)]); return { compact: all, full: null }; }
  const wanted = ['empId', 'name', 'tags', 'type', 'duration', 'date', 'uniqueId'].filter((k) => map[k] != null);
  const cols = wanted.map((k) => map[k]).sort((a, b) => a - b);
  // group contiguous columns into ranges
  const groups = [];
  for (const c of cols) { const g = groups[groups.length - 1]; if (g && c === g.end + 1) g.end = c; else groups.push({ start: c, end: c }); }
  const first = headerIdx + 2;
  const ranges = groups.map((g) => `${a1Sheet(name)}!${colLetter(g.start)}${first}:${colLetter(g.end)}`);
  const blocks = await batchGet(client, sheetId, ranges);
  const total = Math.max(0, ...blocks.map((b) => b.length));
  const byCol = new Map();
  groups.forEach((g, gi) => { for (let c = g.start; c <= g.end; c++) byCol.set(c, { block: blocks[gi], offset: c - g.start }); });
  const typeCol = map.type;
  const out = [wanted.map((k) => head[headerIdx][map[k]])];
  for (let i = 0; i < total; i++) {
    const t = byCol.get(typeCol); const tv = t.block[i]?.[t.offset];
    if (tv == null || tv === '') continue;
    out.push(wanted.map((k) => { const c = byCol.get(map[k]); const v = c.block[i]?.[c.offset]; return v == null ? '' : v; }));
  }
  // Full copy of the populated rows (all columns, formatted as displayed) for the daily archive.
  let full = null;
  if (total > 0) {
    const width = head[headerIdx].length;
    const range = `${a1Sheet(name)}!A${first}:${colLetter(width - 1)}${first + total - 1}`;
    const params = `ranges=${encodeURIComponent(range)}&valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING&majorDimension=ROWS`;
    const data = await getJson(client, `${API}/${sheetId}/values:batchGet?${params}`);
    const rows = (data.valueRanges?.[0]?.values || []).filter((r) => r[typeCol] != null && String(r[typeCol]).trim() !== '');
    full = { header: head[headerIdx].map((h) => String(h ?? '')), rows: rows.map((r) => Array.from({ length: width }, (_, c) => (r[c] == null ? '' : String(r[c])))), dateCol: map.date };
  }
  return { compact: out, full };
}

/**
 * @returns {Promise<{ sheets: Record<string, any[][]>, sheetNames: string[] }>}
 */
export async function fetchSheetsFromGoogle({ sheetId, dbSheetName, helperSheetName, rawSheetName, directorySheets }, sa) {
  const client = await makeClient(sa);
  const meta = await getJson(client, `${API}/${sheetId}?fields=sheets.properties(title,gridProperties(rowCount,columnCount))`);
  const titles = (meta.sheets || []).map((s) => s.properties.title);
  const has = (n) => titles.includes(n);
  const sheets = {};
  const wholeSheets = [dbSheetName, helperSheetName, ...directorySheets].filter(has);
  if (wholeSheets.length) {
    const values = await batchGet(client, sheetId, wholeSheets.map(a1Sheet));
    wholeSheets.forEach((n, i) => { sheets[n] = values[i]; });
  }
  let rawFull = null;
  if (has(rawSheetName)) {
    const { compact, full } = await readCallLog(client, sheetId, rawSheetName);
    sheets[rawSheetName] = compact;
    rawFull = full;
  }
  return { sheets, sheetNames: titles, rawFull };
}
