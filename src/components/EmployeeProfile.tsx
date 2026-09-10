import { ArrowLeft, GitCompare } from 'lucide-react';
import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { METRICS, scoreBand, type MetricKey } from '../config/metrics';
import { formatDate, formatRange } from '../lib/dates';
import { formatDuration, formatMetric, formatNumber, initials } from '../lib/format';
import { describeEmployee, employeeInsights } from '../lib/insights';
import type { EmployeeStats } from '../lib/metrics';
import { useTheme } from '../state/ThemeContext';
import { useRouter } from '../state/router';
import type { Analytics } from '../state/useAnalytics';
import { BandStrip } from './DurationBands';
import { EmployeeStanding } from './EmployeeStanding';
import { InsightsPanel } from './InsightsPanel';
import { PerformanceChart } from './PerformanceChart';
import { Card } from './ui/Card';
import { TooltipFrame } from './ui/ChartTooltip';
import { Badge, Button } from './ui/Controls';
import { EmptyState } from './ui/States';

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line px-3 py-2 dark:border-line-dark">
      <div className="text-[11px] text-ink-muted">{label}</div>
      <div className="mt-0.5 text-base font-semibold text-ink dark:text-ink-dark">{value}</div>
      {sub && <div className="text-[11px] text-ink-muted">{sub}</div>}
    </div>
  );
}

export function EmployeeProfile({ analytics, stat }: { analytics: Analytics; stat: EmployeeStats }) {
  const { navigate } = useRouter();
  const { chart } = useTheme();
  const { team, prevStats, range, prevRange, dataset, has } = analytics;
  const e = stat.employee;
  const prevStat = prevStats.find((s) => s.employee.id === e.id) ?? null;
  const m = stat.metrics;
  const band = scoreBand(stat.score);
  const insights = useMemo(() => employeeInsights({ stat, prevStat, team, available: dataset.available }), [stat, prevStat, team, dataset.available]);
  const records = useMemo(() => analytics.records.filter((r) => r.empId === e.id), [analytics.records, e.id]);
  const prevRecords = useMemo(() => analytics.prevRecords.filter((r) => r.empId === e.id), [analytics.prevRecords, e.id]);

  // Team comparison: per-active-day rates for the employee vs the team average per employee-day.
  const compareRows = useMemo(() => {
    const activeDays = Math.max(1, stat.totals.activeDays);
    const teamDays = Math.max(1, team.totals.records);
    const rows: { key: MetricKey; label: string; you: number | null; team: number | null; format: 'decimal' | 'seconds' | 'percent' }[] = [];
    if (has('totalCalls')) rows.push({ key: 'totalCalls', label: 'Calls / day', you: m.callsPerDay ?? null, team: (team.metrics.totalCalls ?? 0) / teamDays, format: 'decimal' });
    if (has('connected')) rows.push({ key: 'connected', label: 'Connected / day', you: (m.connected ?? 0) / activeDays, team: (team.metrics.connected ?? 0) / teamDays, format: 'decimal' });
    if (has('talkTime')) rows.push({ key: 'talkTime', label: 'Talk time / day', you: (m.talkTime ?? 0) / activeDays, team: (team.metrics.talkTime ?? 0) / teamDays, format: 'seconds' });
    if (has('connectionRate')) rows.push({ key: 'connectionRate', label: 'Connection rate', you: m.connectionRate ?? null, team: team.metrics.connectionRate ?? null, format: 'percent' });
    if (has('avgTalkTime')) rows.push({ key: 'avgTalkTime', label: 'Avg talk time / call', you: m.avgTalkTime ?? null, team: team.metrics.avgTalkTime ?? null, format: 'seconds' });
    return rows;
  }, [stat, team, m, has]);

  const compareData = compareRows.filter((r) => r.format !== 'seconds' && r.format !== 'percent').map((r) => ({ label: r.label, you: r.you ?? 0, team: r.team ?? 0 }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="ghost" onClick={() => navigate('employee')}><ArrowLeft className="h-4 w-4" /> All executives</Button>
        <Button size="sm" onClick={() => navigate('compare', e.id)}><GitCompare className="h-4 w-4" /> Compare</Button>
      </div>

      <Card>
        <div className="flex flex-wrap items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-[#184f95] dark:bg-accent-soft-dark dark:text-[#cde2fb]">{initials(e.name)}</span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-ink dark:text-ink-dark">{e.name}</h2>
            <p className="text-xs text-ink-muted">{[e.id.startsWith('NAME:') ? null : e.id, describeEmployee(e)].filter(Boolean).join(' · ') || 'No profile details in the sheet'}</p>
            <p className="mt-1 text-xs text-ink-secondary dark:text-ink-dark-secondary">Selected period: <span className="font-medium">{formatRange(range.from, range.to)}</span> · compared with {formatRange(prevRange.from, prevRange.to)}</p>
          </div>
          {has('score') && (
            <div className="text-right">
              <div className="text-[11px] text-ink-muted">Performance Score <span title={METRICS.score.description}>(calculated)</span></div>
              <div className="flex items-center justify-end gap-2">
                <span className="text-2xl font-semibold text-ink dark:text-ink-dark">{stat.score ?? '–'}</span>
                {band && <Badge tone={band.tone}>{band.label}</Badge>}
              </div>
            </div>
          )}
        </div>
        {stat.totals.activeDays === 0 ? (
          <div className="mt-4"><EmptyState title="No activity recorded" message={`No calls were logged for ${e.name} between ${formatRange(range.from, range.to)}.`} /></div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {has('totalCalls') && <Stat label="Total Calls" value={formatNumber(m.totalCalls)} sub={has('dialed') && has('incoming') ? `${formatNumber(m.dialed)} dialed · ${formatNumber(m.incoming)} incoming` : undefined} />}
            {has('connected') && <Stat label="Total Connected" value={formatNumber(m.connected)} sub={stat.totals.bandRecords === 0 ? 'numbers connected · no call detail' : undefined} />}
            {has('uniqueConnected') && m.uniqueConnected != null && <Stat label="Unique Connected" value={formatNumber(m.uniqueConnected)} sub={stat.totals.uniqueRecords === 0 ? 'same as Total Connected · no call detail' : stat.totals.uniqueRecords < stat.totals.records ? 'distinct numbers on call-log days' : 'distinct numbers per day'} />}
            {has('missed') && m.outgoingCalls != null && <Stat label="Outgoing Calls" value={formatNumber(m.outgoingCalls)} sub="call-log days only" />}
            {has('missed') && m.incomingCalls != null && <Stat label="Incoming Calls" value={formatNumber(m.incomingCalls)} sub="answered · call-log days only" />}
            {has('missed') && m.missed != null && <Stat label="Missed Calls" value={formatNumber(m.missed)} sub="call-log days only" />}
            {has('rejected') && m.rejected != null && <Stat label="Rejected Calls" value={formatNumber(m.rejected)} sub="call-log days only" />}
            {has('notConnected') && <Stat label="Not Connected" value={formatNumber(m.notConnected)} />}
            {has('connectionRate') && <Stat label="Connection Rate" value={formatMetric(m.connectionRate, 'percent')} sub={team.metrics.connectionRate != null ? `team ${formatMetric(team.metrics.connectionRate, 'percent')}` : undefined} />}
            {has('talkTime') && <Stat label="Total Talk Time" value={formatDuration(m.talkTime)} />}
            {has('avgTalkTime') && <Stat label="Average Talk Time" value={formatDuration(m.avgTalkTime)} sub="per connected call" />}
            {has('callsPerDay') && <Stat label="Calls Per Day" value={formatNumber(m.callsPerDay, 1)} sub="average on active days" />}
            <Stat label="Active Days" value={formatNumber(stat.totals.activeDays)} sub={`of ${formatNumber(analytics.daily.length)} team days`} />
            {stat.bestDay && <Stat label="Best Day" value={formatDate(stat.bestDay.date)} sub={`${formatNumber(stat.bestDay.metrics.totalCalls)} calls`} />}
            {stat.lowestDay && <Stat label="Lowest Activity Day" value={formatDate(stat.lowestDay.date)} sub={`${formatNumber(stat.lowestDay.metrics.totalCalls)} calls`} />}
            {has('avgDailyTalkTime') && <Stat label="Avg Daily Talk Time" value={formatDuration(m.avgDailyTalkTime)} />}
            {has('band02') && m.band02 != null && <Stat label="Calls 0–2 min" value={formatNumber(m.band02)} sub="call-log days only" />}
            {has('band24') && m.band24 != null && <Stat label="Calls 2–4 min" value={formatNumber(m.band24)} sub="call-log days only" />}
            {has('band4p') && m.band4p != null && <Stat label="Calls over 4 min" value={formatNumber(m.band4p)} sub="call-log days only" />}
            {prevStat && prevStat.totals.activeDays > 0 && has('callsPerDay') && <Stat label="Previous Period Calls / Day" value={formatNumber(prevStat.metrics.callsPerDay, 1)} sub={`${formatNumber(prevStat.metrics.totalCalls)} calls · ${prevStat.totals.activeDays} days`} />}
          </div>
        )}
      </Card>

      {stat.totals.activeDays > 0 && (
        <>
          <EmployeeStanding analytics={analytics} stat={stat} />
          <PerformanceChart title="Daily Activity" records={records} prevRecords={prevRecords} available={dataset.available} employeeById={dataset.employeeById} employeeName={e.name} range={range} showPreviousToggle />

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Comparison with Team Average" subtitle="Per active day for the executive vs per employee-day for the selected team">
              {compareData.length > 0 && (
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={compareData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={18} barGap={2}>
                      <CartesianGrid stroke={chart.grid} vertical={false} />
                      <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: chart.axis }} />
                      <YAxis tickLine={false} axisLine={false} width={40} />
                      <Tooltip cursor={{ fill: chart.grid, opacity: 0.4 }} content={({ active, payload, label }) => active && payload?.length ? <TooltipFrame title={String(label)} rows={[{ label: e.name, value: formatNumber(payload[0].value as number, 1), color: chart.series[0] }, { label: 'Team average', value: formatNumber(payload[1]?.value as number, 1), color: chart.series[1] }]} /> : null} />
                      <Legend verticalAlign="top" height={24} iconType="circle" />
                      <Bar name={e.name} dataKey="you" fill={chart.series[0]} radius={[4, 4, 0, 0]} maxBarSize={36} />
                      <Bar name="Team average" dataKey="team" fill={chart.series[1]} radius={[4, 4, 0, 0]} maxBarSize={36} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <table className="mt-2 w-full text-xs">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted"><th className="py-1 font-medium">Metric</th><th className="py-1 text-right font-medium">{e.name.split(' ')[0]}</th><th className="py-1 text-right font-medium">Team avg</th><th className="py-1 text-right font-medium">Difference</th></tr></thead>
                <tbody>
                  {compareRows.map((r) => {
                    const diff = r.you != null && r.team != null && r.team !== 0 ? (r.you - r.team) / r.team : null;
                    const good = diff == null ? null : diff >= 0;
                    return (
                      <tr key={r.key} className="border-t border-line dark:border-line-dark">
                        <td className="py-1 text-ink-secondary dark:text-ink-dark-secondary">{r.label}</td>
                        <td className="tabular py-1 text-right font-medium text-ink dark:text-ink-dark">{formatMetric(r.you, r.format)}</td>
                        <td className="tabular py-1 text-right text-ink-secondary dark:text-ink-dark-secondary">{formatMetric(r.team, r.format)}</td>
                        <td className={`tabular py-1 text-right font-medium ${good == null ? 'text-ink-muted' : good ? 'text-[#006300] dark:text-[#5fd35f]' : 'text-[#8f1f1f] dark:text-[#f08c8c]'}`}>{r.format === 'percent' ? (r.you != null && r.team != null ? `${r.you - r.team >= 0 ? '+' : '−'}${(Math.abs(r.you - r.team) * 100).toFixed(1)} pp` : '–') : diff == null ? '–' : `${diff >= 0 ? '+' : '−'}${Math.abs(diff * 100).toFixed(1)}%`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
            <div className="space-y-4">
              {has('band02') && (
                <Card title="Call Duration Bands" subtitle="Connected calls by length · from the daily call log">
                  <BandStrip totals={stat.totals} />
                  {team.totals.bandRecords > 0 && stat.totals.bandRecords > 0 && (
                    <div className="mt-3 border-t border-line pt-3 dark:border-line-dark">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Team mix for comparison</div>
                      <BandStrip totals={team.totals} compact />
                    </div>
                  )}
                </Card>
              )}
              <InsightsPanel title="Insights" subtitle={`Based on ${e.name}'s calculated metrics for the selected period`} insights={insights} />
            </div>
          </div>

          <Card title="Daily Activity Log" subtitle={`${formatNumber(stat.daily.length)} active days in the selected period`} bodyClassName="!px-0 !py-0">
            <div className="max-h-96 overflow-auto scroll-thin">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="sticky top-0 bg-surface dark:bg-surface-dark">
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted dark:border-line-dark">
                    <th className="px-3 py-2 font-medium">Date</th>
                    {has('totalCalls') && <th className="px-3 py-2 text-right font-medium">Total Calls</th>}
                    {has('dialed') && <th className="px-3 py-2 text-right font-medium">Dialed</th>}
                    {has('incoming') && <th className="px-3 py-2 text-right font-medium">Incoming</th>}
                    {has('connected') && <th className="px-3 py-2 text-right font-medium">Total Connected</th>}
                    {has('connectionRate') && <th className="px-3 py-2 text-right font-medium">Conn. Rate</th>}
                    {has('talkTime') && <th className="px-3 py-2 text-right font-medium">Talk Time</th>}
                  </tr>
                </thead>
                <tbody>
                  {[...stat.daily].reverse().map((d) => (
                    <tr key={d.date} className="border-b border-line last:border-0 dark:border-line-dark">
                      <td className="px-3 py-1.5 text-ink dark:text-ink-dark">{formatDate(d.date)}</td>
                      {has('totalCalls') && <td className="tabular px-3 py-1.5 text-right">{formatNumber(d.metrics.totalCalls)}</td>}
                      {has('dialed') && <td className="tabular px-3 py-1.5 text-right">{formatNumber(d.metrics.dialed)}</td>}
                      {has('incoming') && <td className="tabular px-3 py-1.5 text-right">{formatNumber(d.metrics.incoming)}</td>}
                      {has('connected') && <td className="tabular px-3 py-1.5 text-right">{formatNumber(d.metrics.connected)}</td>}
                      {has('connectionRate') && <td className="tabular px-3 py-1.5 text-right">{formatMetric(d.metrics.connectionRate, 'percent')}</td>}
                      {has('talkTime') && <td className="tabular px-3 py-1.5 text-right">{formatDuration(d.metrics.talkTime)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
