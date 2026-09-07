import type { BaseMetricKey } from '../types';

/**
 * Metric registry. Every KPI, chart series, table column and ranking option is
 * defined here once. `requires` lists the base fields that must exist in the
 * source for the metric to be shown; anything whose requirements are missing is
 * hidden automatically instead of breaking the UI.
 */
export type MetricKey =
  | 'totalCalls'
  | 'dialed'
  | 'incoming'
  | 'connected'
  | 'dialedConnected'
  | 'incomingConnected'
  | 'notConnected'
  | 'connectionRate'
  | 'talkTime'
  | 'avgTalkTime'
  | 'avgDailyTalkTime'
  | 'callsPerDay'
  | 'activeDays'
  | 'score'
  | 'band02'
  | 'band24'
  | 'band4p'
  | 'ttBand02'
  | 'ttBand24'
  | 'ttBand4p'
  | 'uniqueConnected'
  | 'uqBand02'
  | 'uqBand24'
  | 'uqBand4p';

export type MetricFormat = 'count' | 'seconds' | 'percent' | 'score' | 'decimal';

export interface MetricDef {
  key: MetricKey;
  label: string;
  shortLabel: string;
  format: MetricFormat;
  /** any-of groups: metric is available when at least one key of EVERY group exists */
  requires: BaseMetricKey[][];
  description: string;
  /** whether a higher value is better (used by score/insights/ranking) */
  higherIsBetter: boolean;
  /** sum-able across employees/days (false for rates & averages) */
  additive: boolean;
}

export const METRICS: Record<MetricKey, MetricDef> = {
  totalCalls: {
    key: 'totalCalls', label: 'Total Calls', shortLabel: 'Calls', format: 'count',
    requires: [['dialed', 'incoming']], higherIsBetter: true, additive: true,
    description: 'Dialed (outgoing) plus incoming calls.',
  },
  dialed: {
    key: 'dialed', label: 'Dialed Calls', shortLabel: 'Dialed', format: 'count',
    requires: [['dialed']], higherIsBetter: true, additive: true,
    description: 'Outgoing calls placed by the executive.',
  },
  incoming: {
    key: 'incoming', label: 'Incoming Calls', shortLabel: 'Incoming', format: 'count',
    requires: [['incoming']], higherIsBetter: true, additive: true,
    description: 'Calls received by the executive.',
  },
  connected: {
    key: 'connected', label: 'Connected Calls', shortLabel: 'Connected', format: 'count',
    requires: [['dialedConnected', 'incomingConnected']], higherIsBetter: true, additive: true,
    description: 'Calls that were answered (dialed + incoming).',
  },
  dialedConnected: {
    key: 'dialedConnected', label: 'Dialed - Connected', shortLabel: 'Dialed conn.', format: 'count',
    requires: [['dialedConnected']], higherIsBetter: true, additive: true,
    description: 'Outgoing calls that were answered.',
  },
  incomingConnected: {
    key: 'incomingConnected', label: 'Incoming - Connected', shortLabel: 'Incoming conn.', format: 'count',
    requires: [['incomingConnected']], higherIsBetter: true, additive: true,
    description: 'Incoming calls that were answered.',
  },
  notConnected: {
    key: 'notConnected', label: 'Not Connected Calls', shortLabel: 'Not connected', format: 'count',
    requires: [['dialed', 'incoming', 'notConnected'], ['dialedConnected', 'incomingConnected', 'notConnected']],
    higherIsBetter: false, additive: true,
    description: 'Total calls minus connected calls.',
  },
  connectionRate: {
    key: 'connectionRate', label: 'Connection Rate', shortLabel: 'Conn. rate', format: 'percent',
    requires: [['dialed', 'incoming'], ['dialedConnected', 'incomingConnected']], higherIsBetter: true, additive: false,
    description: 'Connected calls as a share of total calls.',
  },
  talkTime: {
    key: 'talkTime', label: 'Total Talk Time', shortLabel: 'Talk time', format: 'seconds',
    requires: [['talkTimeDialed', 'talkTimeIncoming']], higherIsBetter: true, additive: true,
    description: 'Sum of dialed and incoming talk time.',
  },
  avgTalkTime: {
    key: 'avgTalkTime', label: 'Average Talk Time', shortLabel: 'Avg talk time', format: 'seconds',
    requires: [['talkTimeDialed', 'talkTimeIncoming'], ['dialedConnected', 'incomingConnected']], higherIsBetter: true, additive: false,
    description: 'Talk time per connected call.',
  },
  avgDailyTalkTime: {
    key: 'avgDailyTalkTime', label: 'Avg Daily Talk Time', shortLabel: 'Talk time / day', format: 'seconds',
    requires: [['talkTimeDialed', 'talkTimeIncoming']], higherIsBetter: true, additive: false,
    description: 'Talk time per active day.',
  },
  callsPerDay: {
    key: 'callsPerDay', label: 'Average Calls Per Day', shortLabel: 'Calls / day', format: 'decimal',
    requires: [['dialed', 'incoming']], higherIsBetter: true, additive: false,
    description: 'Total calls divided by active days.',
  },
  activeDays: {
    key: 'activeDays', label: 'Active Days', shortLabel: 'Active days', format: 'count',
    requires: [['dialed', 'incoming']], higherIsBetter: true, additive: false,
    description: 'Days with at least one call recorded.',
  },
  band02: {
    key: 'band02', label: 'Calls 0–2 min', shortLabel: '0–2 min', format: 'count',
    requires: [['band02']], higherIsBetter: true, additive: true,
    description: 'Connected calls lasting up to 2 minutes. Counted from the call log, so only days with call-level data are included.',
  },
  band24: {
    key: 'band24', label: 'Calls 2–4 min', shortLabel: '2–4 min', format: 'count',
    requires: [['band24']], higherIsBetter: true, additive: true,
    description: 'Connected calls lasting between 2 and 4 minutes (call-log days only).',
  },
  band4p: {
    key: 'band4p', label: 'Calls over 4 min', shortLabel: '> 4 min', format: 'count',
    requires: [['band4p']], higherIsBetter: true, additive: true,
    description: 'Connected calls lasting more than 4 minutes (call-log days only).',
  },
  ttBand02: {
    key: 'ttBand02', label: 'Talk Time in 0–2 min Calls', shortLabel: 'Talk 0–2', format: 'seconds',
    requires: [['ttBand02']], higherIsBetter: true, additive: true,
    description: 'Talk time spent on connected calls lasting up to 2 minutes (call-log days only).',
  },
  ttBand24: {
    key: 'ttBand24', label: 'Talk Time in 2–4 min Calls', shortLabel: 'Talk 2–4', format: 'seconds',
    requires: [['ttBand24']], higherIsBetter: true, additive: true,
    description: 'Talk time spent on connected calls lasting 2 to 4 minutes (call-log days only).',
  },
  ttBand4p: {
    key: 'ttBand4p', label: 'Talk Time in Calls over 4 min', shortLabel: 'Talk > 4', format: 'seconds',
    requires: [['ttBand4p']], higherIsBetter: true, additive: true,
    description: 'Talk time spent on connected calls longer than 4 minutes (call-log days only).',
  },
  uniqueConnected: {
    key: 'uniqueConnected', label: 'Unique Connected', shortLabel: 'Unique conn.', format: 'count',
    requires: [['uniqueConnected']], higherIsBetter: true, additive: true,
    description: 'Distinct customer numbers each executive connected to, counted per day from the call log and summed over the period. Repeat connections to the same number on the same day count once.',
  },
  uqBand02: {
    key: 'uqBand02', label: 'Unique Connected 0–2 min', shortLabel: 'Unique 0–2', format: 'count',
    requires: [['uqBand02']], higherIsBetter: true, additive: true,
    description: 'Unique numbers whose longest connected call that day lasted up to 2 minutes (call-log days only).',
  },
  uqBand24: {
    key: 'uqBand24', label: 'Unique Connected 2–4 min', shortLabel: 'Unique 2–4', format: 'count',
    requires: [['uqBand24']], higherIsBetter: true, additive: true,
    description: 'Unique numbers whose longest connected call that day lasted 2 to 4 minutes (call-log days only).',
  },
  uqBand4p: {
    key: 'uqBand4p', label: 'Unique Connected over 4 min', shortLabel: 'Unique > 4', format: 'count',
    requires: [['uqBand4p']], higherIsBetter: true, additive: true,
    description: 'Unique numbers whose longest connected call that day lasted more than 4 minutes (call-log days only).',
  },
  score: {
    key: 'score', label: 'Performance Score', shortLabel: 'Score', format: 'score',
    requires: [['dialed', 'incoming'], ['dialedConnected', 'incomingConnected'], ['talkTimeDialed', 'talkTimeIncoming']],
    higherIsBetter: true, additive: false,
    description: 'Calculated dashboard metric (0-100), not a source field. 35% calls, 30% connected, 20% talk time, 15% connection rate, each normalised against the selected team.',
  },
};

export const SCORE_WEIGHTS = { calls: 0.35, connected: 0.3, talkTime: 0.2, connectionRate: 0.15 } as const;

export const SCORE_BANDS = [
  { min: 85, label: 'Excellent', tone: 'good' as const },
  { min: 70, label: 'Good', tone: 'good' as const },
  { min: 50, label: 'Average', tone: 'warning' as const },
  { min: 0, label: 'Needs Attention', tone: 'critical' as const },
];

export function scoreBand(score: number | null) {
  if (score == null || !isFinite(score)) return null;
  return SCORE_BANDS.find((b) => score >= b.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1];
}

export function isMetricAvailable(def: MetricDef, available: Set<BaseMetricKey>): boolean {
  return def.requires.every((group) => group.some((k) => available.has(k)));
}

/** Metrics offered in the time-series chart switcher, in display order. */
export const CHART_METRICS: MetricKey[] = ['totalCalls', 'connected', 'uniqueConnected', 'notConnected', 'talkTime', 'avgTalkTime', 'connectionRate', 'dialed', 'incoming', 'band02', 'band24', 'band4p'];

/** Duration bands in display order with their chart colour slot. */
export const BAND_METRICS: { key: 'band02' | 'band24' | 'band4p'; tt: 'ttBand02' | 'ttBand24' | 'ttBand4p'; uq: 'uqBand02' | 'uqBand24' | 'uqBand4p'; label: string; range: string }[] = [
  { key: 'band02', tt: 'ttBand02', uq: 'uqBand02', label: '0–2 min', range: 'up to 2:00' },
  { key: 'band24', tt: 'ttBand24', uq: 'uqBand24', label: '2–4 min', range: '2:01 to 4:00' },
  { key: 'band4p', tt: 'ttBand4p', uq: 'uqBand4p', label: 'Over 4 min', range: 'more than 4:00' },
];

/** Fixed colours for the three bands (amber, blue, green). */
export const BAND_COLORS = { light: ['#eda100', '#2a78d6', '#1baf7a'], dark: ['#c98500', '#3987e5', '#199e70'] };

/** Ranking options for the leaderboard. */
export const RANKING_METRICS: MetricKey[] = ['totalCalls', 'connected', 'connectionRate', 'talkTime', 'avgTalkTime', 'score'];

/** Heatmap options. */
export const HEATMAP_METRICS: MetricKey[] = ['totalCalls', 'connected', 'talkTime'];

/** Default thresholds for the Needs Attention section (user-adjustable in the UI). */
export const DEFAULT_ATTENTION = { belowAverageRatio: 0.7, declineRatio: 0.3, flagNoActivity: true };
