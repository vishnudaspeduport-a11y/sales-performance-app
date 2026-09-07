/**
 * Daily call-log archive. The sheet's "Raw data" tab is overwritten every day,
 * so each sync stores that day's rows, exactly as displayed in the sheet, as a
 * gzip-compressed CSV in Supabase Storage (one file per calendar date).
 */
import { gzipSync } from 'node:zlib';
import { parseDateCell } from './transform.mjs';

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header, rows) {
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) lines.push(r.map(csvCell).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF). Returns rows of strings. */
export function parseCsv(text) {
  const rows = [];
  let row = []; let cell = ''; let inQuotes = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false; }
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ''));
}

/** Group formatted call rows by their (IST) calendar date. */
export function groupByDate(rawFull, tz = 'Asia/Kolkata') {
  const groups = new Map();
  for (const row of rawFull.rows) {
    const date = parseDateCell(row[rawFull.dateCol], tz);
    if (!date) continue;
    let arr = groups.get(date);
    if (!arr) { arr = []; groups.set(date, arr); }
    arr.push(row);
  }
  return groups;
}

/**
 * Archive every date present in the call log. Re-archiving a date replaces the
 * previous file (the tab may keep filling during the day).
 * @returns {Promise<{ dates: string[], rows: number }>}
 */
export async function archiveCallLog({ repo, rawFull, tz, syncedAt }) {
  if (!rawFull || !rawFull.rows.length || typeof repo.uploadArchive !== 'function') return { dates: [], rows: 0 };
  const groups = groupByDate(rawFull, tz);
  const dates = [];
  let total = 0;
  for (const [date, rows] of [...groups.entries()].sort()) {
    const csv = toCsv(rawFull.header, rows);
    const gz = gzipSync(Buffer.from(csv, 'utf8'), { level: 6 });
    await repo.uploadArchive({ date, gz, rowCount: rows.length, bytes: gz.length, csvBytes: Buffer.byteLength(csv, 'utf8'), columns: rawFull.header, syncedAt });
    dates.push(date);
    total += rows.length;
  }
  return { dates, rows: total };
}

export const ARCHIVE_BUCKET = 'call-log-archive';
export function archivePath(date) { return `calls/${date}.csv.gz`; }
