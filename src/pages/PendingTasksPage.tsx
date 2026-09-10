import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { KPIGrid, type KPI } from '../components/KPICard';
import { Card } from '../components/ui/Card';
import { TooltipFrame } from '../components/ui/ChartTooltip';
import { Segmented, Select } from '../components/ui/Controls';
import { EmptyState } from '../components/ui/States';
import { formatDate, formatTimestampIST } from '../lib/dates';
import { formatNumber } from '../lib/format';
import { ALL_SUBJECTS, aggregateOwners, aggregateTeams, filterRows, historySeries, sumTotals, teamLabel, type CountRule, type PendingTotals } from '../lib/pending';
import { useTheme } from '../state/ThemeContext';
import type { PendingSnapshot } from '../types';

const COLS: { key: keyof PendingTotals; label: string; group: 'IC' | 'LM' | 'Total' }[] = [
  { key: 'icToday', label: 'Today', group: 'IC' },
  { key: 'icOverdue', label: 'Till Yesterday', group: 'IC' },
  { key: 'lmToday', label: 'Today', group: 'LM' },
  { key: 'lmOverdue', label: 'Till Yesterday', group: 'LM' },
  { key: 'total', label: 'Total', group: 'Total' },
];

function Cell({ n, strong = false }: { n: number | null; strong?: boolean }) {
  return <td className={`tabular px-3 py-1.5 text-right ${strong ? 'font-semibold text-ink dark:text-ink-dark' : n === 0 ? 'text-ink-muted' : ''}`}>{n == null ? '–' : formatNumber(n, Number.isInteger(n) ? 0 : 1)}</td>;
}

function GroupHeader({ extra }: { extra?: string[] }) {
  return (
    <>
      <tr className="text-center text-[11px] uppercase tracking-wide text-ink-muted">
        <th />
        {extra?.map((e) => <th key={e} />)}
        <th colSpan={2} className="border-b border-line px-3 py-1 font-medium dark:border-line-dark">IC · Interested Course</th>
        <th colSpan={2} className="border-b border-line px-3 py-1 font-medium dark:border-line-dark">LM · Lead Master</th>
        <th />
      </tr>
    </>
  );
}

export function PendingTasksPage({ pending }: { pending: PendingSnapshot | null }) {
  const { chart, theme } = useTheme();
  const [subject, setSubject] = useState<string>(ALL_SUBJECTS);
  const [rule, setRule] = useState<CountRule>('all');
  const [team, setTeam] = useState<string>('');

  const rows = useMemo(() => (pending ? filterRows(pending, subject, rule) : []), [pending, subject, rule]);
  const teams = useMemo(() => aggregateTeams(rows), [rows]);
  const grand = useMemo(() => sumTotals(teams), [teams]);
  const selectedTeam = team && teams.some((t) => t.team === team) ? team : (teams[0]?.team ?? '');
  const owners = useMemo(() => aggregateOwners(rows, selectedTeam), [rows, selectedTeam]);
  const ownersTotal = useMemo(() => sumTotals(owners), [owners]);
  const trend = useMemo(() => (pending ? historySeries(pending.history, null, rule) : []), [pending, rule]);

  if (!pending) {
    return <EmptyState title="Pending tasks are not available yet" message="The Pending Tasks (Sales Overdue) sheet has not been read by the sync. Check that the sheet is shared with the service account and press Refresh Data." />;
  }

  const bdes = teams.reduce((s, t) => s + t.bdes, 0);
  const kpis: KPI[] = [
    { key: 'icToday', label: 'IC Due Today', value: formatNumber(grand.icToday), sub: 'Interested Course tasks due today', description: 'Interested Course tasks whose due date is today, assigned to the lead owner, owner not resigned.' },
    { key: 'icOverdue', label: 'IC Till Yesterday', value: formatNumber(grand.icOverdue), sub: 'overdue Interested Course tasks', description: 'Interested Course tasks whose due date has passed.' },
    { key: 'lmToday', label: 'LM Due Today', value: formatNumber(grand.lmToday), sub: 'Lead Master tasks due today', description: 'Lead Master tasks whose due date is today.' },
    { key: 'lmOverdue', label: 'LM Till Yesterday', value: formatNumber(grand.lmOverdue), sub: 'overdue Lead Master tasks', description: 'Lead Master tasks whose due date has passed.' },
    { key: 'total', label: 'Total Pending', value: formatNumber(grand.total), sub: `${formatNumber(grand.icToday + grand.lmToday)} today · ${formatNumber(grand.icOverdue + grand.lmOverdue)} overdue`, description: 'All four figures added up.' },
    { key: 'bdes', label: 'Executives With Tasks', value: formatNumber(bdes), sub: bdes ? `${formatNumber(grand.total / bdes, 1)} tasks each on average` : undefined, description: 'Executives who have at least one pending task in the selected subject.' },
  ];

  const subjectOptions = [{ value: ALL_SUBJECTS, label: 'All subjects' }, ...pending.subjects.map((s) => ({ value: s, label: s }))];
  const colors = theme === 'dark' ? ['#3987e5', '#8fbcf0', '#199e70', '#7fd3b0'] : ['#2a78d6', '#9cc3ee', '#1baf7a', '#8fd9b8'];
  const chartData = teams.map((t) => ({ name: t.label, icToday: t.icToday, icOverdue: t.icOverdue, lmToday: t.lmToday, lmOverdue: t.lmOverdue, total: t.total }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-card dark:border-line-dark dark:bg-surface-dark">
        <div className="text-xs text-ink-secondary dark:text-ink-dark-secondary">
          <span className="font-medium text-ink dark:text-ink-dark">Pending Tasks (Sales Overdue)</span> · snapshot of the CRM task list for <span className="font-medium text-ink dark:text-ink-dark">{formatDate(pending.date)}</span>{pending.asOf ? <> · read {formatTimestampIST(pending.asOf)}</> : null}
          <div className="mt-0.5 text-ink-muted">{rule === 'all' ? 'Every task in the ic and lm tabs, by the owner\'s team, the same as filtering the tab by team.' : 'Only tasks assigned to the lead\'s owner whose owner has not resigned, the rule used by some rows of the sheet\'s DB tab.'}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented ariaLabel="Counting rule" value={rule} onChange={setRule} options={[{ value: 'all', label: 'All tasks' }, { value: 'owner', label: 'Assigned to owner only' }]} />
          <Segmented ariaLabel="Subject" value={subject} onChange={setSubject} options={subjectOptions} />
        </div>
      </div>

      <section aria-label="Pending overview">
        <div className="mb-2 flex items-baseline justify-between"><h2 className="text-sm font-semibold text-ink dark:text-ink-dark">Overview</h2><span className="text-xs text-ink-muted">{subject === ALL_SUBJECTS ? 'all subjects' : subject}</span></div>
        <KPIGrid kpis={kpis} />
      </section>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="By BDM team" subtitle="Pending tasks per team · click a team to see its executives" bodyClassName="!px-0 !py-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-surface dark:bg-surface-dark">
                <GroupHeader extra={['bdes']} />
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted dark:border-line-dark">
                  <th className="px-3 py-2 font-medium">Team</th>
                  <th className="px-3 py-2 text-right font-medium" title="Executives with at least one pending task">BDEs</th>
                  {COLS.map((c) => <th key={c.key} className="px-3 py-2 text-right font-medium">{c.label}</th>)}
                  <th className="px-3 py-2 text-right font-medium" title="Total pending divided by executives with tasks">Per BDE</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-line bg-plane/60 font-semibold dark:border-line-dark dark:bg-plane-dark/60">
                  <td className="px-3 py-1.5 text-ink dark:text-ink-dark">Total</td>
                  <Cell n={bdes} strong />
                  {COLS.map((c) => <Cell key={c.key} n={grand[c.key]} strong />)}
                  <Cell n={bdes ? grand.total / bdes : null} strong />
                </tr>
                {teams.map((t) => (
                  <tr key={t.team} onClick={() => setTeam(t.team)} className={`cursor-pointer border-b border-line last:border-0 hover:bg-plane dark:border-line-dark dark:hover:bg-plane-dark ${t.team === selectedTeam ? 'bg-accent-soft/60 dark:bg-accent-soft-dark/40' : ''}`}>
                    <td className="px-3 py-1.5 text-ink dark:text-ink-dark" title={t.team}>{t.label}</td>
                    <Cell n={t.bdes} />
                    {COLS.map((c) => <Cell key={c.key} n={t[c.key]} strong={c.key === 'total'} />)}
                    <Cell n={t.perBde} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="xl:col-span-2" title="Pending by team" subtitle="Due today vs till yesterday, stacked">
          <div style={{ height: Math.max(220, chartData.length * 30 + 40) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barCategoryGap={6}>
                <CartesianGrid stroke={chart.grid} horizontal={false} />
                <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v: number) => formatNumber(v)} height={20} />
                <YAxis type="category" dataKey="name" width={120} tickLine={false} axisLine={false} tick={{ fill: chart.ink, fontSize: 11 }} interval={0} />
                <Tooltip cursor={{ fill: chart.grid, opacity: 0.4 }} content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as (typeof chartData)[number];
                  return <TooltipFrame title={d.name} rows={[{ label: 'IC today', value: formatNumber(d.icToday), color: colors[0] }, { label: 'IC till yesterday', value: formatNumber(d.icOverdue), color: colors[1] }, { label: 'LM today', value: formatNumber(d.lmToday), color: colors[2] }, { label: 'LM till yesterday', value: formatNumber(d.lmOverdue), color: colors[3] }]} footer={`${formatNumber(d.total)} pending`} />;
                }} />
                <Legend verticalAlign="top" height={28} iconType="circle" />
                <Bar dataKey="icToday" name="IC today" stackId="p" fill={colors[0]} maxBarSize={18} />
                <Bar dataKey="icOverdue" name="IC till yesterday" stackId="p" fill={colors[1]} maxBarSize={18} />
                <Bar dataKey="lmToday" name="LM today" stackId="p" fill={colors[2]} maxBarSize={18} />
                <Bar dataKey="lmOverdue" name="LM till yesterday" stackId="p" fill={colors[3]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card
          className="xl:col-span-3"
          title="By executive"
          subtitle={selectedTeam ? `${teamLabel(selectedTeam)} · ${formatNumber(owners.length)} executives with pending tasks` : 'Pick a team'}
          actions={<Select ariaLabel="Team" value={selectedTeam} onChange={setTeam} options={teams.map((t) => ({ value: t.team, label: t.label }))} />}
          bodyClassName="!px-0 !py-0"
        >
          <div className="max-h-[32rem] overflow-auto scroll-thin">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="sticky top-0 bg-surface dark:bg-surface-dark">
                <GroupHeader />
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted dark:border-line-dark">
                  <th className="px-3 py-2 font-medium">Executive</th>
                  {COLS.map((c) => <th key={c.key} className="px-3 py-2 text-right font-medium">{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-line bg-plane/60 font-semibold dark:border-line-dark dark:bg-plane-dark/60">
                  <td className="px-3 py-1.5 text-ink dark:text-ink-dark">Total</td>
                  {COLS.map((c) => <Cell key={c.key} n={ownersTotal[c.key]} strong />)}
                </tr>
                {owners.map((o) => (
                  <tr key={o.owner} className="border-b border-line last:border-0 dark:border-line-dark">
                    <td className="px-3 py-1.5 text-ink dark:text-ink-dark">{o.owner}</td>
                    {COLS.map((c) => <Cell key={c.key} n={o[c.key]} strong={c.key === 'total'} />)}
                  </tr>
                ))}
                {owners.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-ink-muted">No pending tasks for this team and subject.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="xl:col-span-2" title="Day over day" subtitle="Total pending tasks per snapshot day, all teams">
          {trend.length < 2 ? (
            <EmptyState title="Trend builds up from here" message={`One snapshot so far (${formatDate(trend[0]?.date ?? pending.date)}). Each day's sync adds a point.`} />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={chart.grid} vertical={false} />
                  <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: chart.axis }} tickFormatter={(d: string) => formatDate(d, false)} tick={{ fontSize: 11 }} />
                  <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => formatNumber(v)} />
                  <Tooltip content={({ active, payload, label }) => active && payload?.length ? <TooltipFrame title={formatDate(String(label))} rows={[{ label: 'Total pending', value: formatNumber(payload[0].value as number), color: chart.series[0] }, { label: 'Due today', value: formatNumber((payload[0].payload as { icToday: number; lmToday: number }).icToday + (payload[0].payload as { icToday: number; lmToday: number }).lmToday) }, { label: 'Overdue', value: formatNumber((payload[0].payload as { icOverdue: number; lmOverdue: number }).icOverdue + (payload[0].payload as { icOverdue: number; lmOverdue: number }).lmOverdue) }]} /> : null} />
                  <Line type="monotone" dataKey="total" name="Total pending" stroke={chart.series[0]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {pending.notes.length > 0 && (
        <div className="rounded-lg border border-line bg-surface px-4 py-3 text-xs text-ink-secondary dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark-secondary">
          <div className="mb-1 font-medium text-ink dark:text-ink-dark">How the sheet was read</div>
          <ul className="list-disc space-y-0.5 pl-4">{pending.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
