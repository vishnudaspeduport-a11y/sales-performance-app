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
  /** from the icku HR directory when connected */
  title?: string;
  department?: string;
  location?: string;
  joinedOn?: string;
  /** where the manager came from: 'directory' (icku), 'sheet' (Employee Data tab) or 'none' */
  mappingSource?: 'directory' | 'sheet' | 'none';
}

/** One person from the icku HR directory (non-personal columns only). */
export interface DirectoryEntry {
  empNo: string;
  name: string;
  title: string;
  department: string;
  location: string;
  managerEmpNo: string;
  managerName: string;
  status: string;
  joinedOn: string;
  exitDate: string;
}

export interface DirectoryPayload {
  asOf: string;
  sslVerified: boolean;
  /** tuples [empNo, name, title, department, location, managerEmpNo, managerName, status, joinedOn, exitDate] */
  rows: unknown[][];
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
  /** when the icku HR directory was read for this snapshot */
  directoryAsOf?: string;
  /** call-log executives dropped because their Emp Code is unknown: [empCode, name, manager hint, calls by day, total calls] */
  callLogUnknown?: [string, string, string, Record<string, number>, number][];
  /** the call-log days the unknown list covers, latest first */
  callLogUnknownDates?: string[];
  /** what the call log's Emp Codes were checked against: the icku directory or the Helper - Raw header */
  callLogCheckedAgainst?: 'icku' | 'helper';
}

/** Pending Tasks (Sales Overdue) snapshot as served: tuples [source, team, owner, subject, bucket, count]. */
export interface PendingPayload {
  date: string;
  asOf: string | null;
  sources: string[];
  subjects: string[];
  rows: unknown[][];
  /** active CRM users as tuples [empNo, name, role] */
  users?: unknown[][];
  history: { date: string; team: string; ic_today: number; ic_overdue: number; lm_today: number; lm_overdue: number; ic_today_owner?: number; ic_overdue_owner?: number; lm_today_owner?: number; lm_overdue_owner?: number; bdes: number }[];
  notes: string[];
}

export interface PendingRow {
  source: 'IC' | 'LM';
  team: string;
  owner: string;
  subject: string;
  bucket: 'today' | 'overdue' | 'upcoming';
  /** owner = passes the team rule; other = assigned to someone else; unknown = owner not in the user list; resigned = owner has resigned */
  kind: 'owner' | 'other' | 'unknown' | 'resigned';
  count: number;
}

export interface PendingTeamDay {
  date: string;
  team: string;
  icToday: number;
  icOverdue: number;
  lmToday: number;
  lmOverdue: number;
  /** same four, counting only tasks that pass the sheet's rule */
  icTodayOwner: number;
  icOverdueOwner: number;
  lmTodayOwner: number;
  lmOverdueOwner: number;
  bdes: number;
}

export interface PendingSnapshot {
  date: string;
  asOf: string | null;
  subjects: string[];
  rows: PendingRow[];
  users: { empNo: string; name: string; role: string }[];
  history: PendingTeamDay[];
  notes: string[];
}

/** Raw JSON returned by the API. Rows are positional arrays in `fields` order. */
export interface Payload {
  meta: PayloadMeta;
  fields: FieldDef[];
  dims: DimDef[];
  employees: Employee[];
  rows: unknown[][];
  pending?: PendingPayload | null;
  directory?: DirectoryPayload | null;
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
  | 'uniqueConnected'
  | 'uqBand02'
  | 'uqBand24'
  | 'uqBand4p'
  | 'missed'
  | 'rejected';

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
  'uqBand02',
  'uqBand24',
  'uqBand4p',
  'missed',
  'rejected',
];

/** Fields that exist only for days with call-level data (null otherwise). */
export const CALL_LOG_ONLY_KEYS: BaseMetricKey[] = ['band02', 'band24', 'band4p', 'ttBand02', 'ttBand24', 'ttBand4p', 'uniqueConnected', 'uqBand02', 'uqBand24', 'uqBand4p', 'missed', 'rejected'];

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
  /** unique numbers by the band of their longest connected call */
  uqBand02: number | null;
  uqBand24: number | null;
  uqBand4p: number | null;
  /** missed and rejected incoming calls; null when the day has no call-level data */
  missed: number | null;
  rejected: number | null;
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
  /** Pending Tasks (Sales Overdue) snapshot, when that sheet is connected */
  pending: PendingSnapshot | null;
  /** icku HR directory rows for the Team Mapping page (empty when not connected) */
  directory: DirectoryEntry[];
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
