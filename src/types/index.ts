/** Field kinds emitted by the backend (see apps-script/Transform.gs). */
export type FieldKind = 'date' | 'text' | 'count' | 'seconds';

export interface FieldDef {
  key: string;
  label: string;
  concept: string;
  kind: FieldKind;
}

export interface DimDef {
  key: string;
  label: string;
  /** value is a list per employee (e.g. tags) */
  multi?: boolean;
  /** value lives on each daily row instead of on the employee */
  perRow?: boolean;
}

export interface Employee {
  id: string;
  name: string;
  manager: string;
  tags: string[];
  team: string;
  status: string;
}

export interface PayloadMeta {
  sourceMode: string;
  sourceSheets: string[];
  generatedAt: string;
  timezone: string;
  rowCount: number;
  employeeCount: number;
  dateRange: { from: string; to: string } | null;
  notes: string[];
  cacheHit?: boolean;
  cachedAt?: string;
  cacheSeconds?: number;
  buildMs?: number;
  /** true when the page carries an embedded data export instead of a live API */
  snapshot?: boolean;
  /** time the payload was synced from the Google Sheet into the database */
  syncedAt?: string;
  syncRunId?: number;
  /** set on ?refresh=1 responses: whether a background sync was queued */
  refreshQueued?: boolean;
  refreshNote?: string;
}

/** Raw JSON returned by the API. Rows are positional arrays in `fields` order. */
export interface Payload {
  meta: PayloadMeta;
  fields: FieldDef[];
  dims: DimDef[];
  employees: Employee[];
  rows: unknown[][];
  error?: string;
  detail?: string;
}

/** Base (source) metric keys that a daily record may carry. */
export type BaseMetricKey =
  | 'dialed'
  | 'dialedConnected'
  | 'talkTimeDialed'
  | 'incoming'
  | 'incomingConnected'
  | 'talkTimeIncoming'
  | 'notConnected'
  | 'band02'
  | 'band24'
  | 'band4p'
  | 'ttBand02'
  | 'ttBand24'
  | 'ttBand4p'
  | 'uniqueConnected';

export const BASE_METRIC_KEYS: BaseMetricKey[] = [
  'dialed',
  'dialedConnected',
  'talkTimeDialed',
  'incoming',
  'incomingConnected',
  'talkTimeIncoming',
  'notConnected',
  'band02',
  'band24',
  'band4p',
  'ttBand02',
  'ttBand24',
  'ttBand4p',
  'uniqueConnected',
];

/** Fields that exist only for days with call-level data (null otherwise). */
export const CALL_LOG_ONLY_KEYS: BaseMetricKey[] = ['band02', 'band24', 'band4p', 'ttBand02', 'ttBand24', 'ttBand4p', 'uniqueConnected'];

/** Call-duration band keys (connected calls only). Null on a record = no call-level data that day. */
export const BAND_KEYS = ['band02', 'band24', 'band4p'] as const;
export type BandKey = (typeof BAND_KEYS)[number];

/** One employee-day, normalised (talk time in seconds, dates as YYYY-MM-DD in IST). */
export interface DailyRecord {
  date: string;
  empId: string;
  dialed: number;
  dialedConnected: number;
  talkTimeDialed: number;
  incoming: number;
  incomingConnected: number;
  talkTimeIncoming: number;
  notConnected: number;
  /** connected calls by duration band; null when the day has no call-level data */
  band02: number | null;
  band24: number | null;
  band4p: number | null;
  /** talk time (seconds) inside each band; null when unknown */
  ttBand02: number | null;
  ttBand24: number | null;
  ttBand4p: number | null;
  /** distinct customer numbers connected that day; null when unknown */
  uniqueConnected: number | null;
  /** per-row dimension values (only in flat-DB mode) */
  dims: Record<string, string>;
}

export interface Dataset {
  meta: PayloadMeta;
  fields: FieldDef[];
  dims: DimDef[];
  employees: Employee[];
  employeeById: Map<string, Employee>;
  records: DailyRecord[];
  /** which base metrics exist in the source */
  available: Set<BaseMetricKey>;
  /** min/max date present */
  dateRange: { from: string; to: string } | null;
}

export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'thisWeek'
  | 'thisMonth'
  | 'prevMonth'
  | 'all'
  | 'custom';

export interface Filters {
  preset: DatePreset;
  from: string;
  to: string;
  /** selected employee ids; empty = all */
  employees: string[];
  /** dimension key -> selected values; empty = all */
  dims: Record<string, string[]>;
}

export interface AttentionConfig {
  /** flag when calls < this fraction of the team average (0.7 = 70 %) */
  belowAverageRatio: number;
  /** flag when calls dropped by more than this fraction vs previous period */
  declineRatio: number;
  /** flag employees in scope with no activity in the period */
  flagNoActivity: boolean;
}

export type Granularity = 'daily' | 'weekly' | 'monthly';
