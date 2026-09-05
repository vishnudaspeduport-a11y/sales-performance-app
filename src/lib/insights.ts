/**
 * Data-driven insight sentences. Every sentence is built only from numbers the
 * dashboard has already calculated; nothing here guesses.
 */
import type { AttentionConfig, BaseMetricKey, DailyRecord, Employee } from '../types';
import { WEEKDAYS, formatDate, formatRange } from './dates';
import { formatDuration, formatNumber, formatPercent, pluralize } from './format';
import { compareMetrics, computeDayOfWeek, type EmployeeStats, type PeriodPoint, type TeamStats, type MetricValues } from './metrics';

export interface Insight {
  text: string;
  tone: 'neutral' | 'positive' | 'negative';
}

const pct = (x: number) => `${Math.abs(x * 100).toFixed(1)}%`;

export function teamInsights(args: {
  records: DailyRecord[];
  stats: EmployeeStats[];
  team: TeamStats;
  prevTeam: TeamStats | null;
  daily: PeriodPoint[];
  available: Set<BaseMetricKey>;
  range: { from: string; to: string };
  attention: { belowAverage: EmployeeStats[]; noActivity: EmployeeStats[] };
}): Insight[] {
  const { stats, team, prevTeam, daily, available, records, attention } = args;
  const out: Insight[] = [];
  if (!records.length) return out;

  if (team.highest && team.highest.calls > 0) {
    out.push({ tone: 'positive', text: `${team.highest.employee.name} made the highest number of calls (${formatNumber(team.highest.calls)}) during the selected period.` });
  }

  if (prevTeam && prevTeam.totals.records > 0) {
    const cmp = compareMetrics(team.metrics, prevTeam.metrics, ['totalCalls', 'connected', 'connectionRate', 'talkTime']);
    const calls = cmp[0];
    if (calls.deltaPct != null && Math.abs(calls.deltaPct) >= 0.005) {
      out.push({ tone: calls.deltaPct > 0 ? 'positive' : 'negative', text: `Team calling activity ${calls.deltaPct > 0 ? 'increased' : 'decreased'} ${pct(calls.deltaPct)} compared with the previous period.` });
    }
    const rate = cmp[2];
    if (rate.deltaAbs != null && Math.abs(rate.deltaAbs) >= 0.005) {
      out.push({ tone: rate.deltaAbs > 0 ? 'positive' : 'negative', text: `Connection rate ${rate.deltaAbs > 0 ? 'improved' : 'declined'} by ${(Math.abs(rate.deltaAbs) * 100).toFixed(1)} percentage points.` });
    }
    const talk = cmp[3];
    if (talk.deltaPct != null && Math.abs(talk.deltaPct) >= 0.05) {
      out.push({ tone: talk.deltaPct > 0 ? 'positive' : 'negative', text: `Total talk time ${talk.deltaPct > 0 ? 'rose' : 'fell'} ${pct(talk.deltaPct)} versus the previous period.` });
    }
  }

  const dow = computeDayOfWeek(records, available).filter((d) => d.days > 0 && d.avgCalls != null);
  if (dow.length >= 2) {
    const best = dow.reduce((a, b) => ((b.avgCalls ?? 0) > (a.avgCalls ?? 0) ? b : a));
    out.push({ tone: 'neutral', text: `${WEEKDAYS[best.dow]} had the highest average call volume (${formatNumber(best.avgCalls)} calls per day).` });
  }

  if (daily.length >= 2) {
    const top = daily.reduce((a, b) => ((b.metrics.totalCalls ?? 0) > (a.metrics.totalCalls ?? 0) ? b : a));
    out.push({ tone: 'neutral', text: `Highest team activity occurred on ${formatDate(top.from)} with ${formatNumber(top.metrics.totalCalls)} calls.` });
  }

  if (attention.belowAverage.length) {
    out.push({ tone: 'negative', text: `${pluralize(attention.belowAverage.length, 'executive')} made fewer calls than the team average threshold in this period.` });
  }
  if (attention.noActivity.length) {
    out.push({ tone: 'negative', text: `${pluralize(attention.noActivity.length, 'executive')} had no activity recorded for the selected period.` });
  }

  if (team.metrics.connectionRate != null) {
    out.push({ tone: 'neutral', text: `Overall connection rate for the period is ${formatPercent(team.metrics.connectionRate)} across ${formatNumber(team.metrics.totalCalls)} calls.` });
  }
  if (team.metrics.avgTalkTime != null && stats.some((s) => s.totals.activeDays > 0)) {
    out.push({ tone: 'neutral', text: `Average talk time per connected call is ${formatDuration(team.metrics.avgTalkTime)}.` });
  }
  return out;
}

export function employeeInsights(args: {
  stat: EmployeeStats;
  prevStat: EmployeeStats | null;
  team: TeamStats;
  available: Set<BaseMetricKey>;
}): Insight[] {
  const { stat, prevStat, team, available } = args;
  const out: Insight[] = [];
  if (stat.totals.activeDays === 0) return out;
  const m = stat.metrics;

  // Calls per day vs team average per employee-day
  if (m.callsPerDay != null && team.avgCallsPerEmployeeDay != null && team.avgCallsPerEmployeeDay > 0) {
    const d = (m.callsPerDay - team.avgCallsPerEmployeeDay) / team.avgCallsPerEmployeeDay;
    if (Math.abs(d) >= 0.005) out.push({ tone: d > 0 ? 'positive' : 'negative', text: `${pct(d)} ${d > 0 ? 'above' : 'below'} team average daily calls (${formatNumber(m.callsPerDay, 1)} vs ${formatNumber(team.avgCallsPerEmployeeDay, 1)}).` });
    else out.push({ tone: 'neutral', text: 'Daily calls are in line with the team average.' });
  }
  if (m.connectionRate != null && team.metrics.connectionRate != null) {
    const d = m.connectionRate - team.metrics.connectionRate;
    if (Math.abs(d) >= 0.005) out.push({ tone: d > 0 ? 'positive' : 'negative', text: `Connection rate is ${(Math.abs(d) * 100).toFixed(1)} percentage points ${d > 0 ? 'above' : 'below'} the team average.` });
  }
  if (m.avgTalkTime != null && team.metrics.avgTalkTime != null && team.metrics.avgTalkTime > 0) {
    const d = (m.avgTalkTime - team.metrics.avgTalkTime) / team.metrics.avgTalkTime;
    if (Math.abs(d) >= 0.05) out.push({ tone: d > 0 ? 'positive' : 'negative', text: `Average talk time per call is ${pct(d)} ${d > 0 ? 'longer' : 'shorter'} than the team average.` });
  }
  if (stat.daily.length >= 3) {
    const dow = computeDayOfWeek(stat.daily.map((d) => ({ date: d.date, empId: stat.employee.id, dialed: d.totals.dialed, dialedConnected: d.totals.dialedConnected, talkTimeDialed: d.totals.talkTimeDialed, incoming: d.totals.incoming, incomingConnected: d.totals.incomingConnected, talkTimeIncoming: d.totals.talkTimeIncoming, notConnected: d.totals.notConnectedExplicit, dims: {} })), available).filter((x) => x.days > 0);
    if (dow.length >= 2) {
      const best = dow.reduce((a, b) => ((b.avgCalls ?? 0) > (a.avgCalls ?? 0) ? b : a));
      out.push({ tone: 'neutral', text: `Highest activity typically occurs on ${WEEKDAYS[best.dow]}.` });
    }
  }
  if (prevStat && prevStat.totals.activeDays > 0 && prevStat.metrics.callsPerDay != null && m.callsPerDay != null) {
    const d = (m.callsPerDay - prevStat.metrics.callsPerDay) / prevStat.metrics.callsPerDay;
    if (Math.abs(d) >= 0.005) out.push({ tone: d > 0 ? 'positive' : 'negative', text: `Average daily calls ${d > 0 ? 'increased' : 'decreased'} ${pct(d)} compared with the previous period.` });
  }
  if (stat.bestDay) out.push({ tone: 'neutral', text: `Best day was ${formatDate(stat.bestDay.date)} with ${formatNumber(stat.bestDay.metrics.totalCalls)} calls.` });
  return out;
}

export interface AttentionItem {
  stat: EmployeeStats;
  reasons: { label: string; detail: string }[];
}

export function findNeedsAttention(args: {
  stats: EmployeeStats[];
  prevStats: EmployeeStats[];
  team: TeamStats;
  config: AttentionConfig;
  range: { from: string; to: string };
}): AttentionItem[] {
  const { stats, prevStats, team, config } = args;
  const prevById = new Map(prevStats.map((s) => [s.employee.id, s]));
  const avg = team.avgCallsPerEmployeeDay ?? 0;
  const out: AttentionItem[] = [];
  for (const s of stats) {
    const reasons: AttentionItem['reasons'] = [];
    if (s.totals.activeDays === 0) {
      // Only flag executives who were active in the immediately preceding period,
      // so people who left long ago are not listed every day.
      const wasActive = (prevById.get(s.employee.id)?.totals.activeDays ?? 0) > 0;
      if (config.flagNoActivity && wasActive) reasons.push({ label: 'No Activity Recorded', detail: `No calls logged for ${formatRange(args.range.from, args.range.to)} (active in the previous period).` });
    } else {
      const cpd = s.metrics.callsPerDay ?? 0;
      if (avg > 0 && cpd < avg * config.belowAverageRatio) {
        reasons.push({ label: 'Below Team Average', detail: `${formatNumber(cpd, 1)} calls/day vs team ${formatNumber(avg, 1)} (${Math.round((cpd / avg) * 100)}%).` });
      }
      const prev = prevById.get(s.employee.id);
      if (prev && prev.totals.activeDays > 0 && prev.metrics.callsPerDay) {
        const d = (cpd - prev.metrics.callsPerDay) / prev.metrics.callsPerDay;
        if (d <= -config.declineRatio) reasons.push({ label: 'Decline vs Previous Period', detail: `Daily calls down ${pct(d)} (${formatNumber(prev.metrics.callsPerDay, 1)} → ${formatNumber(cpd, 1)}).` });
      }
    }
    if (reasons.length) out.push({ stat: s, reasons });
  }
  // most severe first: no activity, then largest gap
  return out.sort((a, b) => {
    const na = a.stat.totals.activeDays === 0 ? 0 : 1; const nb = b.stat.totals.activeDays === 0 ? 0 : 1;
    if (na !== nb) return na - nb;
    return (a.stat.metrics.callsPerDay ?? 0) - (b.stat.metrics.callsPerDay ?? 0);
  });
}

export function describeEmployee(e: Employee): string {
  const bits = [e.manager && `Manager: ${e.manager}`, e.team && `Team: ${e.team}`, e.tags.length && `Tags: ${e.tags.join(', ')}`, e.status && `Status: ${e.status}`].filter(Boolean);
  return bits.join(' · ');
}

export function metricsSummary(m: MetricValues): string {
  return [m.totalCalls != null && `${formatNumber(m.totalCalls)} calls`, m.connected != null && `${formatNumber(m.connected)} connected`, m.talkTime != null && formatDuration(m.talkTime)].filter(Boolean).join(' · ');
}
