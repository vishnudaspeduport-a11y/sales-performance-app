/**
 * Local source: an .xlsx export of the Google Sheet (File → Download → Excel).
 * Used by scripts/dev-api.mjs and scripts/selftest.mjs so the whole pipeline
 * can run without Google or Supabase credentials.
 */
import { createRequire } from 'node:module';
import { RAW_LOG_ALIASES, mapHeaders } from './transform.mjs';

const require = createRequire(import.meta.url);

export function sheetsFromWorkbook(path, rawSheetName = 'Raw data') {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(path, { cellDates: false });
  const sheets = {};
  let rawFull = null;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    sheets[name] = ws && ws['!ref'] ? XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) : [];
    if (name === rawSheetName && ws && ws['!ref']) {
      // Formatted copy (dates/times as displayed) of the populated call rows for the archive.
      const formatted = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
      let headerIdx = -1; let map = null;
      for (let r = 0; r < Math.min(10, formatted.length); r++) {
        const m = mapHeaders(formatted[r], RAW_LOG_ALIASES);
        if (m.type != null && m.date != null) { headerIdx = r; map = m; break; }
      }
      if (map) {
        const header = formatted[headerIdx].map((h) => String(h ?? ''));
        const rows = formatted.slice(headerIdx + 1).filter((r) => String(r[map.type] ?? '').trim() !== '').map((r) => header.map((_, c) => String(r[c] ?? '')));
        rawFull = { header, rows, dateCol: map.date };
      }
    }
  }
  return { sheets, sheetNames: wb.SheetNames, rawFull };
}
