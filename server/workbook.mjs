/**
 * Local source: an .xlsx export of the Google Sheet (File → Download → Excel).
 * Used by scripts/dev-api.mjs and scripts/selftest.mjs so the whole pipeline
 * can run without Google or Supabase credentials.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function sheetsFromWorkbook(path) {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(path, { cellDates: false });
  const sheets = {};
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    sheets[name] = ws && ws['!ref'] ? XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) : [];
  }
  return { sheets, sheetNames: wb.SheetNames };
}
