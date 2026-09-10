import { useMemo } from 'react';
import { METRICS, type MetricKey } from '../config/metrics';
import { formatRange } from '../lib/dates';
import { formatMetric, formatNumber } from '../lib/format';
import { rankBy, type EmployeeStats } from '../lib/metrics';
import { computeRangeStats, type Analytics } from '../state/useAnalytics';
import { Card } from './ui/Card';
import { Badge } from './ui/Controls';

const STANDING_METRICS: MetricKey[] = ['totalCalls', 'connected', 'uniqueConnected', 'talkTime', 'connectionRate', 'avgTalkTime', 'callsPerDay', 'score'];

const value = (s: EmployeeStats, key: MetricKey): number | null => (key === 'score' ? s.score : s.metrics[key]) ?? null;

function rankOf(list: EmployeeStats[], id: string, key: MetricKey): { rank: number; of: number } | null {
  const ranked = rankBy(list.filter((s) => value(s, key) != null), key);
  const i = ranked.findIndex((s) => s.employee.id === id);
  return i < 0 ? null : { rank: i + 1, of: ranked.length };
}

function mean(list: EmployeeStats[], key: MetricKey): number | null {
  const vals = list.map((s) => value(s, key)).filter((v): v is number => v != null && isFinite(v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function tone(rank: { rank: number; of: number } | null): 'good' | 'warning' | 'critical' | 'neutral' {
  if (!rank || rank.of < 2) return 'neutral';
  const p = rank.rank / rank.of;
  return p <= 0.25 ? 'good' : p <= 0.6 ? 'neutral' : p <= 0.85 ? 'warning' : 'critical';
}

function diffText(v: number | null, avg: number | null, key: MetricKey): { text: string; good: boolean | null } {
  if (v == null || avg == null) return { text: '–', good: null };
  const def = METRICS[key];
  if (def.format === 'percent') { const d = (v - avg) * 100; return { text: `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} pp`, good: d === 0 ? null : def.higherIsBetter ? d > 0 : d < 0 }; }
  if (avg === 0) return { text: '–', good: null };
  const d = (v - avg) / Math.abs(avg);
  return { text: `${d >= 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(0)}%`, good: d === 0 ? null : def.higherIsBetter ? d > 0 : d < 0 };
}

/**
 * Where one executive stands for the selected period: rank and average inside their manager's
 * team and across every sales executive with activity, regardless of the filters at the top.
 */
export function EmployeeStanding({ analytics, stat }: { analytics: Analytics; stat: EmployeeStats }) {
  const { dataset, filters, range, has } = analytics;
  const e = stat.employee;

  const { dept, team, me } = useMemo(() => {
    // Whole department, ignoring the manager / executive filters so the rank is against everyone.
    const all = computeRangeStats(dataset, { ...filters, employees: [], dims: {} }, range, dataset.employees);
    const active = all.stats.filter((s) => s.totals.activeDays > 0);
    const mine = active.find((s) => s.employee.id === e.id) ?? null;
    const teamList = e.manager ? active.filter((s) => s.employee.manager === e.manager) : [];
    return { dept: active, team: teamList, me: mine };
  }, [dataset, filters, range, e.id, e.manager]);

  if (!me) return null;
  const metrics = STANDING_METRICS.filter(has);
  const headline = rankOf(dept, e.id, 'totalCalls');
  const teamHeadline = e.manager ? rankOf(team, e.id, 'totalCalls') : null;
  const scoreRank = has('score') ? rankOf(dept, e.id, 'score') : null;

  return (
    <Card
      title="Standing"
      subtitle={`${formatRange(range.from, range.to)} · ranked against every executive with calls in that period, not only the filtered ones`}
    >
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {headline && <Badge tone={tone(headline)}>#{headline.rank} of {headline.of} in the sales department by calls</Badge>}
        {teamHeadline && <Badge tone={tone(teamHeadline)}>#{teamHeadline.rank} of {teamHeadline.of} in {e.manager}'s team by calls</Badge>}
        {scoreRank && <Badge tone={tone(scoreRank)}>#{scoreRank.rank} of {scoreRank.of} by performance score</Badge>}
      </div>
      <div className="overflow-x-auto">
        <table className="zebra w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted dark:border-line-dark">
              <th className="px-3 py-2 font-medium">Metric</th>
              <th className="px-3 py-2 text-right font-medium">{e.name.split(' ')[0]}</th>
              <th className="px-3 py-2 text-right font-medium" title="Position among the executives under the same manager">Team rank</th>
              <th className="px-3 py-2 text-right font-medium" title="Average per executive under the same manager">Team avg</th>
              <th className="px-3 py-2 text-right font-medium" title="Position among every sales executive with activity">Dept rank</th>
              <th className="px-3 py-2 text-right font-medium" title="Average per executive across the whole department">Dept avg</th>
              <th className="px-3 py-2 text-right font-medium">vs dept</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((key) => {
              const def = METRICS[key];
              const v = value(me, key);
              const tr = team.length ? rankOf(team, e.id, key) : null;
              const dr = rankOf(dept, e.id, key);
              const ta = team.length ? mean(team, key) : null;
              const da = mean(dept, key);
              const d = diffText(v, da, key);
              return (
                <tr key={key} className="border-b border-line last:border-0 dark:border-line-dark">
                  <td className="px-3 py-1.5 text-ink dark:text-ink-dark">{def.label}</td>
                  <td className="tabular px-3 py-1.5 text-right font-semibold text-ink dark:text-ink-dark">{formatMetric(v, def.format)}</td>
                  <td className="tabular px-3 py-1.5 text-right">{tr ? <Badge tone={tone(tr)}>#{tr.rank} / {tr.of}</Badge> : <span className="text-ink-muted">–</span>}</td>
                  <td className="tabular px-3 py-1.5 text-right text-ink-secondary dark:text-ink-dark-secondary">{formatMetric(ta, def.format)}</td>
                  <td className="tabular px-3 py-1.5 text-right">{dr ? <Badge tone={tone(dr)}>#{dr.rank} / {dr.of}</Badge> : <span className="text-ink-muted">–</span>}</td>
                  <td className="tabular px-3 py-1.5 text-right text-ink-secondary dark:text-ink-dark-secondary">{formatMetric(da, def.format)}</td>
                  <td className={`tabular px-3 py-1.5 text-right font-medium ${d.good == null ? 'text-ink-muted' : d.good ? 'text-[#006300] dark:text-[#5fd35f]' : 'text-[#8f1f1f] dark:text-[#f08c8c]'}`}>{d.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-ink-muted">Averages are per executive over the period{e.manager ? `; the team is the ${formatNumber(team.length)} executives under ${e.manager} with calls in the period` : ''}; the department is the {formatNumber(dept.length)} executives with calls. Green ranks are in the top quarter, red in the bottom 15%.</p>
    </Card>
  );
}
