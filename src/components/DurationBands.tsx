import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BAND_COLORS, BAND_METRICS } from '../config/metrics';
import { formatDate, formatRange } from '../lib/dates';
import { formatDuration, formatNumber, formatPercent } from '../lib/format';
import { bandSummary, rankBy, type BandSummary, type EmployeeStats, type Totals } from '../lib/metrics';
import { useTheme } from '../state/ThemeContext';
import { useRouter } from '../state/router';
import { Card } from './ui/Card';
import { TooltipFrame } from './ui/ChartTooltip';
import { Segmented } from './ui/Controls';
import { EmptyState } from './ui/States';

function coverageText(s: BandSummary): string {
  if (!s.days.length) return '';
  if (s.days.length === 1) return `based on call-level data for ${formatDate(s.days[0])}`;
  return `based on ${s.days.length} days with call-level data (${formatRange(s.days[0], s.days[s.days.length - 1])})`;
}

/** Stacked share bar + counts for one set of totals. */
export function BandStrip({ totals, compact = false }: { totals: Totals; compact?: boolean }) {
  const { theme } = useTheme();
  const s = bandSummary(totals);
  if (!s) return <p className="text-xs text-ink-muted">No call-level data in this period, so duration bands are not available.</p>;
  const colors = theme === 'dark' ? BAND_COLORS.dark : BAND_COLORS.light;
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-plane dark:bg-plane-dark" role="img" aria-label={`Duration mix: ${BAND_METRICS.map((b) => `${b.label} ${formatPercent(s.shares[b.key], 0)}`).join(', ')}`}>
        {BAND_METRICS.map((b, i) => <div key={b.key} style={{ width: `${s.shares[b.key] * 100}%`, background: colors[i] }} title={`${b.label}: ${formatNumber(s.counts[b.key])} (${formatPercent(s.shares[b.key])})`} />)}
      </div>
      <div className={`mt-2 grid gap-2 ${compact ? 'grid-cols-3' : 'grid-cols-3'}`}>
        {BAND_METRICS.map((b, i) => (
          <div key={b.key} className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] text-ink-muted"><span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: colors[i] }} />{b.label}</div>
            <div className="text-base font-semibold text-ink dark:text-ink-dark">{formatNumber(s.counts[b.key])}</div>
            <div className="text-[11px] text-ink-muted">{formatPercent(s.shares[b.key])} of {formatNumber(s.total)} calls</div>
            {s.talkTotal > 0 && <div className="text-[11px] text-ink-muted">{formatDuration(s.talk[b.key])} talk · {formatPercent(s.talkShares[b.key], 0)}</div>}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-ink-muted">Connected calls only · {coverageText(s)}</p>
    </div>
  );
}

/** Team-level card: overall mix plus a per-executive stacked bar chart. */
export function DurationBands({ stats, teamTotals, compact = false }: { stats: EmployeeStats[]; teamTotals: Totals; compact?: boolean }) {
  const { chart, theme } = useTheme();
  const { navigate } = useRouter();
  const [mode, setMode] = useState<'count' | 'share'>('count');
  const [limit, setLimit] = useState<'10' | '15' | 'all'>(compact ? '10' : '15');
  const colors = theme === 'dark' ? BAND_COLORS.dark : BAND_COLORS.light;
  const team = bandSummary(teamTotals);

  const data = useMemo(() => {
    const withBands = stats.filter((s) => s.totals.bandRecords > 0);
    const ranked = rankBy(withBands, 'connected');
    const rows = ranked.slice(0, limit === 'all' ? ranked.length : Number(limit)).map((s) => {
      const b = bandSummary(s.totals)!;
      return {
        id: s.employee.id, name: s.employee.name, total: b.total,
        band02: mode === 'count' ? b.counts.band02 : b.shares.band02,
        band24: mode === 'count' ? b.counts.band24 : b.shares.band24,
        band4p: mode === 'count' ? b.counts.band4p : b.shares.band4p,
        counts: b.counts, shares: b.shares,
      };
    });
    return rows;
  }, [stats, mode, limit]);

  return (
    <Card
      className={compact ? 'flex h-full flex-col' : ''}
      title="Call Duration Bands"
      subtitle="How long connected calls lasted · 0–2 min, 2–4 min, over 4 min · from the daily call log"
      actions={
        <>
          <Segmented ariaLabel="Band display" value={mode} onChange={setMode} options={[{ value: 'count', label: 'Counts' }, { value: 'share', label: 'Share %' }]} />
          <Segmented ariaLabel="Executives shown" value={limit} onChange={setLimit} options={[{ value: '10', label: 'Top 10' }, { value: '15', label: 'Top 15' }, { value: 'all', label: 'All' }]} />
        </>
      }
    >
      {!team ? (
        <EmptyState title="No call-level data in this period" message="Duration bands are counted from the daily Raw data tab. Days that exist only in the helper sheet have no call detail. Choose a period that includes an archived call-log day." />
      ) : (
        <div className={compact ? 'flex flex-col gap-4' : 'grid gap-6 lg:grid-cols-3'}>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Team</h3>
            <BandStrip totals={teamTotals} compact={compact} />
          </div>
          <div className={compact ? '' : 'lg:col-span-2'}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">By executive · ranked by connected calls</h3>
            <div style={{ height: Math.max(160, data.length * (compact ? 26 : 28) + 40) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barCategoryGap={5} onClick={(e) => { const p = (e as { activePayload?: { payload: { id: string } }[] })?.activePayload?.[0]?.payload; if (p) navigate('employee', p.id); }}>
                  <CartesianGrid stroke={chart.grid} horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} domain={mode === 'share' ? [0, 1] : [0, 'auto']} tickFormatter={(v: number) => (mode === 'share' ? `${Math.round(v * 100)}%` : formatNumber(v))} height={20} />
                  <YAxis type="category" dataKey="name" width={130} tickLine={false} axisLine={false} tick={{ fill: chart.ink, fontSize: 11 }} interval={0} />
                  <Tooltip cursor={{ fill: chart.grid, opacity: 0.4 }} content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as (typeof data)[number];
                    return <TooltipFrame title={d.name} rows={BAND_METRICS.map((b, i) => ({ label: b.label, value: `${formatNumber(d.counts[b.key])} (${formatPercent(d.shares[b.key])})`, color: colors[i] }))} footer={`${formatNumber(d.total)} connected calls · click to open profile`} />;
                  }} />
                  <Legend verticalAlign="top" height={24} iconType="circle" />
                  {BAND_METRICS.map((b, i) => <Bar key={b.key} dataKey={b.key} name={b.label} stackId="bands" fill={colors[i]} maxBarSize={18} className="cursor-pointer" />)}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
