/** Environment access with clear errors. Server-side only. */
export function env(name, fallback) {
  const v = process.env[name];
  if (v == null || String(v).trim() === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing environment variable ${name}`);
  }
  return String(v);
}

export function serviceAccount() {
  let raw = env('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!raw.trim().startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8');
  const sa = JSON.parse(raw);
  if (!sa.client_email || !sa.private_key) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not a service-account key (client_email / private_key missing).');
  return sa;
}

export function sheetConfig() {
  return {
    sheetId: env('SHEET_ID', '1dBOcU2tsCugNsB14_v6fXg_E7NZHcpK7vofL5BrUtic'),
    dbSheetName: env('DB_SHEET', 'DB'),
    helperSheetName: env('HELPER_SHEET', 'Helper - Raw'),
    rawSheetName: env('RAW_SHEET', 'Raw data'),
    directorySheets: env('DIRECTORY_SHEETS', 'Employee Data,Resigned,Sheet12,DB-BDMs').split(',').map((s) => s.trim()).filter(Boolean),
    tz: 'Asia/Kolkata',
  };
}

export function cacheSeconds() {
  const n = Number(env('CACHE_SECONDS', '180'));
  return Number.isFinite(n) && n >= 0 ? n : 180;
}

/** Minimum seconds between two syncs triggered by the Refresh button. */
export const MIN_REFRESH_INTERVAL_S = 60;
/** A "running" sync older than this is considered dead and may be replaced. */
export const STALE_RUN_MINUTES = 15;
