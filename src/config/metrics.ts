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
  | 'score';

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
export const CHART_METRICS: MetricKey[] = ['totalCalls', 'connected', 'notConnected', 'talkTime', 'avgTalkTime', 'connectionRate', 'dialed', 'incoming'];

/** Ranking options for the leaderboard. */
export const RANKING_METRICS: MetricKey[] = ['totalCalls', 'connected', 'connectionRate', 'talkTime', 'avgTalkTime', 'score'];

/** Heatmap options. */
export const HEATMAP_METRICS: MetricKey[] = ['totalCalls', 'connected', 'talkTime'];

/** Default thresholds for the Needs Attention section (user-adjustable in the UI). */
export const DEFAULT_ATTENTION = { belowAverageRatio: 0.7, declineRatio: 0.3, flagNoActivity: true };
