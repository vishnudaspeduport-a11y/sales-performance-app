import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { KPIGrid, type KPI } from '../components/KPICard';
import { Card } from '../components/ui/Card';
import { TooltipFrame } from '../components/ui/ChartTooltip';
import { Badge, Button, SearchInput, Segmented, Select } from '../components/ui/Controls';
import { EmptyState } from '../components/ui/States';
import { addDays, formatDate, formatTimestampIST } from '../lib/dates';
import { formatDuration, formatNumber } from '../lib/format';
import { ALL_SUBJECTS, TARGET_LABEL, aggregateOwners, aggregateTeams, executiveBreakdown, filterRows, historySeries, overdueOf, sumTotals, targetTone, teamLabel, type CountRule, type PendingTotals, type TargetTone } from '../lib/pending';
import { useTheme } from '../state/ThemeContext';
import type { Dataset, Employee, PendingSnapshot } from '../types';

const COLS: { key: keyof PendingTotals; label: string; group: 'IC' | 'LM' | 'Total' }[] = [
  { key: 'icToday', label: 'Today', group: 'IC' },
  { key: 'icOverdue', label: 'Till Yesterday', group: 'IC' },
  { key: 'lmToday', label: 'Today', group: 'LM' },
  { key: 'lmOverdue', label: 'Till Yesterday', group: 'LM' },
  { key: 'total', label: 'Total', group: 'Total' },
];
/** Ageing of the overdue tasks (IC + LM together). */
const AGE_COLS: { key: keyof PendingTotals; label: string; title: string }[] = [
  { key: 'age1_3', label: '1–3 d', title: 'Overdue by 1 to 3 days' },
  { key: 'age4_7', label: '4–7 d', title: 'Overdue by 4 to 7 days' },
  { key: 'age8p', label: '8+ d', title: 'Overdue by 8 days or more' },
];

const TARGET_KEY = 'pending.target';
const DEFAULT_TARGET = 5;
function loadTarget(): number {
  try { const n = Number(localStorage.getItem(TARGET_KEY)); return n > 0 ? n : DEFAULT_TARGET; } catch { return DEFAULT_TARGET; }
}

function Cell({ n, strong = false, muted = false, title }: { n: number | null; strong?: boolean; muted?: boolean; title?: string }) {
  return <td title={title} className={`tabular px-3 py-1.5 text-right ${strong ? 'font-semibold text-ink dark:text-ink-dark' : n === 0 || muted ? 'text-ink-muted' : ''}`}>{n == null ? '–' : formatNumber(n, Number.isInteger(n) ? 0 : 1)}</td>;
}

/** Ageing cells; when a snapshot predates ageing the split is unknown and shown as dashes. */
function AgeCells({ t }: { t: PendingTotals }) {
  const known = t.age1_3 + t.age4_7 + t.age8p > 0 || t.ageUnknown === 0;
  return <>{AGE_COLS.map((c) => <Cell key={c.key} n={known ? t[c.key] : null} strong={c.key === 'age8p' && t.age8p > 0} title={c.title} />)}</>;
}

function StatusCell({ tone }: { tone: TargetTone }) {
  return <td className="px-3 py-1.5 text-right">{tone === 'neutral' ? <span className="text-ink-muted">–</span> : <Badge tone={tone}>{TARGET_LABEL[tone]}</Badge>}</td>;
}

const ROW_TONE: Record<TargetTone, string> = {
  good: '', neutral: '',
  warning: 'bg-[#fff3d6]/60 dark:bg-[#3a2c0a]/40',
  critical: 'bg-[#fbe4e4]/70 dark:bg-[#3d1717]/40',
};

function GroupHeader({ extra, trailing = 1 }: { extra?: string[]; trailing?: number }) {
  return (
    <tr className="text-center text-[11px] uppercase tracking-wide text-ink-muted">
      <th />
      {extra?.map((e) => <th key={e} />)}
      <th colSpan={2} className="border-b border-line px-3 py-1 font-medium dark:border-line-dark">IC · Interested Course</th>
      <th colSpan={2} className="border-b border-line px-3 py-1 font-medium dark:border-line-dark">LM · Lead Master</th>
      <th />
      <th colSpan={3} className="border-b border-line px-3 py-1 font-medium dark:border-line-dark" title="How long the overdue tasks (IC + LM) have been overdue">Overdue age</th>
      {Array.from({ length: trailing }, (_, i) => <th key={i} />)}
    </tr>
  );
}

/** Find the executive's call records: by employee number from the sheet's user list, else by name. */
function findEmployee(dataset: Dataset, pending: PendingSnapshot, owner: string): Employee | null {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const user = pending.users.find((u) => key(u.name) === key(owner));
  if (user?.empNo) { const e = dataset.employeeById.get(user.empNo); if (e) return e; }
  return dataset.employees.find((e) => key(e.name) === key(owner)) ?? null;
}

function ExecutiveDrilldown({ pending, dataset, team, owner, onClose }: { pending: PendingSnapshot; dataset: Dataset; team: string; owner: string; onClose: () => void }) {
  const rows = useMemo(() => executiveBreakdown(filterRows(pending, ALL_SUBJECTS, 'exec'), team, owner), [pending, team, owner]);
  const total = rows.reduce((a, r) => ({ today: a.today + r.today, age1_3: a.age1_3 + r.age1_3, age4_7: a.age4_7 + r.age4_7, age8p: a.age8p + r.age8p, ageUnknown: a.ageUnknown + r.ageUnknown, upcoming: a.upcoming + r.upcoming, total: a.total + r.total }), { today: 0, age1_3: 0, age4_7: 0, age8p: 0, ageUnknown: 0, upcoming: 0, total: 0 });
  const employee = useMemo(() => findEmployee(dataset, pending, owner), [dataset, pending, owner]);
  // Calls on the 7 days up to the snapshot day, so the backlog can be read against the dialling effort.
  const days = useMemo(() => {
    if (!employee) return [];
    const from = addDays(pending.date, -6);
    const byDate = new Map<string, { date: string; calls: number; connected: number; talk: number }>();
    for (let i = 0; i < 7; i++) { const d = addDays(from, i); byDate.set(d, { date: d, calls: 0, connected: 0, talk: 0 }); }
    for (const r of dataset.records) {
      if (r.empId !== employee.id || r.date < from || r.date > pending.date) continue;
      const d = byDate.get(r.date); if (!d) continue;
      d.calls += r.dialed + r.incoming; d.connected += r.dialedConnected + r.incomingConnected; d.talk += r.talkTimeDialed + r.talkTimeIncoming;
    }
    return [...byDate.values()];
  }, [dataset.records, employee, pending.date]);
  const callTotal = days.reduce((a, d) => ({ calls: a.calls + d.calls, connected: a.connected + d.connected, talk: a.talk + d.talk }), { calls: 0, connected: 0, talk: 0 });
  const activeDays = days.filter((d) => d.calls > 0).length;
  const ageKnown = total.age1_3 + total.age4_7 + total.age8p > 0 || total.ageUnknown === 0;
  const num = (n: number, strong = false) => <td className={`tabular px-3 py-1.5 text-right ${strong ? 'font-semibold text-ink dark:text-ink-dark' : n === 0 ? 'text-ink-muted' : ''}`}>{formatNumber(n)}</td>;

  return (
    <Card
      title={<span>{owner} <span className="font-normal text-ink-muted">· {teamLabel(team)}</span></span>}
      subtitle={`${formatNumber(total.total)} tasks on ${formatDate(pending.date)}: ${formatNumber(total.today)} due today · ${formatNumber(total.age1_3 + total.age4_7 + total.age8p + total.ageUnknown)} overdue${total.age8p ? ` (${formatNumber(total.age8p)} for 8 days or more)` : ''} · ${formatNumber(total.upcoming)} upcoming`}
      actions={<Button size="sm" variant="ghost" onClick={onClose} aria-label="Close executive details"><X className="h-4 w-4" /> Close</Button>}
      bodyClassName="!px-0 !py-0"
    >
      <div className="grid xl:grid-cols-5">
        <div className="min-w-0 overflow-x-auto xl:col-span-3 xl:border-r xl:border-line xl:dark:border-line-dark">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted dark:border-line-dark">
                <th className="px-3 py-2 font-medium">Tasks by subject</th>
                <th className="px-3 py-2 text-right font-medium">Today</th>
                <th className="px-3 py-2 text-right font-medium" title="Overdue by 1 to 3 days">1–3 d</th>
                <th className="px-3 py-2 text-right font-medium" title="Overdue by 4 to 7 days">4–7 d</th>
                <th className="px-3 py-2 text-right font-medium" title="Overdue by 8 days or more">8+ d</th>
                <th className="px-3 py-2 text-right font-medium">Upcoming</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.source}|${r.subject}`} className="border-b border-line last:border-0 dark:border-line-dark">
                  <td className="px-3 py-1.5 text-ink dark:text-ink-dark"><span className={`mr-2 inline-block rounded px-1.5 text-[10px] font-semibold ${r.source === 'IC' ? 'bg-accent-soft text-[#184f95] dark:bg-accent-soft-dark dark:text-[#cde2fb]' : 'bg-[#e6f5e6] text-[#006300] dark:bg-[#12331a] dark:text-[#5fd35f]'}`}>{r.source}</span>{r.subject}</td>
                  {num(r.today)}
                  {ageKnown ? <>{num(r.age1_3)}{num(r.age4_7)}{num(r.age8p, r.age8p > 0)}</> : <><td className="px-3 text-right text-ink-muted">–</td><td className="px-3 text-right text-ink-muted">–</td><td className="px-3 text-right text-ink-muted" title={`${formatNumber(r.ageUnknown)} overdue, age not recorded in this snapshot`}>{formatNumber(r.ageUnknown)}</td></>}
                  {num(r.upcoming)}
                  {num(r.total, true)}
                </tr>
              ))}
              {rows.length > 0 && (
                <tr className="bg-plane/60 font-semibold dark:bg-plane-dark/60">
                  <td className="px-3 py-1.5 text-ink dark:text-ink-dark">Total</td>
                  {num(total.today, true)}
                  {ageKnown ? <>{num(total.age1_3, true)}{num(total.age4_7, true)}{num(total.age8p, true)}</> : <><td className="px-3 text-right text-ink-muted">–</td><td className="px-3 text-right text-ink-muted">–</td>{num(total.ageUnknown, true)}</>}
                  {num(total.upcoming, true)}
                  {num(total.total, true)}
                </tr>
              )}
              {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-ink-muted">No pending tasks for this executive.</td></tr>}
            </tbody>
          </table>
          {!ageKnown && <p className="px-3 py-2 text-[11px] text-ink-muted">This snapshot was taken before ageing was recorded; the split by days appears from the next sync.</p>}
        </div>
        <div className="min-w-0 overflow-x-auto xl:col-span-2">
          <table className="w-full min-w-[320px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted dark:border-line-dark">
                <th className="px-3 py-2 font-medium" title="Calls from the Callyzer sheet on the 7 days up to the snapshot day">Calls · last 7 days</th>
                <th className="px-3 py-2 text-right font-medium">Calls</th>
                <th className="px-3 py-2 text-right font-medium">Connected</th>
                <th className="px-3 py-2 text-right font-medium">Talk time</th>
              </tr>
            </thead>
            <tbody>
              {employee ? days.map((d) => (
                <tr key={d.date} className="border-b border-line last:border-0 dark:border-line-dark">
                  <td className={`px-3 py-1.5 ${d.date === pending.date ? 'font-medium text-ink dark:text-ink-dark' : 'text-ink-secondary dark:text-ink-dark-secondary'}`}>{formatDate(d.date, false)}</td>
                  {num(d.calls)}{num(d.connected)}
                  <td className={`tabular px-3 py-1.5 text-right ${d.talk === 0 ? 'text-ink-muted' : ''}`}>{formatDuration(d.talk)}</td>
                </tr>
              )) : <tr><td colSpan={4} className="px-3 py-6 text-center text-xs text-ink-muted">No call data found for {owner}. The name in the Pending Tasks sheet does not match an executive in the Callyzer data.</td></tr>}
              {employee && (
                <tr className="bg-plane/60 font-semibold dark:bg-plane-dark/60">
                  <td className="px-3 py-1.5 text-ink dark:text-ink-dark">{activeDays} active {activeDays === 1 ? 'day' : 'days'}</td>
                  {num(callTotal.calls, true)}{num(callTotal.connected, true)}
                  <td className="tabular px-3 py-1.5 text-right text-ink dark:text-ink-dark">{formatDuration(callTotal.talk)}</td>
                </tr>
              )}
            </tbody>
          </table>
          {employee && <p className="px-3 py-2 text-[11px] text-ink-muted">{employee.name}{employee.manager ? ` · reports to ${employee.manager}` : ''} · calls up to {formatDate(pending.date)}{dataset.dateRange && dataset.dateRange.to < pending.date ? ` (call data ends ${formatDate(dataset.dateRange.to)})` : ''}</p>}
        </div>
      </div>
    </Card>
  );
}

export function PendingTasksPage({ pending, dataset }: { pending: PendingSnapshot | null; dataset: Dataset }) {
  const { chart, theme } = useTheme();
  const [subject, setSubject] = useState<string>(ALL_SUBJECTS);
  const [rule, setRule] = useState<CountRule>('owner');
  const [team, setTeam] = useState<string>('');
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<number>(loadTarget);
  const [picked, setPicked] = useState<{ team: string; owner: string } | null>(null);
  useEffect(() => { try { localStorage.setItem(TARGET_KEY, String(target)); } catch { /* ignore */ } }, [target]);

  const rows = useMemo(() => (pending ? filterRows(pending, subject, rule) : []), [pending, subject, rule]);
  // The executive list follows the sheet's per-executive block: every task of the executive,
  // resigned executives left out, whatever the team switch says. With a search term it spans every team.
  const execRows = useMemo(() => (pending ? filterRows(pending, subject, 'exec') : []), [pending, subject]);
  const teams = useMemo(() => aggregateTeams(rows), [rows]);
  const grand = useMemo(() => sumTotals(teams), [teams]);
  const selectedTeam = team && (teams.some((t) => t.team === team) || execRows.some((r) => r.team === team)) ? team : (teams[0]?.team ?? execRows[0]?.team ?? '');
  const q = query.trim().toLowerCase();
  const owners = useMemo(() => (q ? aggregateOwners(execRows, null).filter((o) => o.owner.toLowerCase().includes(q)) : aggregateOwners(execRows, selectedTeam)), [execRows, selectedTeam, q]);
  const ownersTotal = useMemo(() => sumTotals(owners), [owners]);
  const trend = useMemo(() => (pending ? historySeries(pending.history, null, rule) : []), [pending, rule]);

  if (!pending) {
    return <EmptyState title="Pending tasks are not available yet" message="The Pending Tasks (Sales Overdue) sheet has not been read by the sync. Check that the sheet is shared with the service account and press Refresh Data." />;
  }

  const bdes = teams.reduce((s, t) => s + t.bdes, 0);
  const overTarget = teams.filter((t) => targetTone(overdueOf(t), t.bdes, target) !== 'good' && t.bdes > 0);
  const ageKnown = grand.age1_3 + grand.age4_7 + grand.age8p > 0 || grand.ageUnknown === 0;
  const kpis: KPI[] = [
    { key: 'icToday', label: 'IC Due Today', value: formatNumber(grand.icToday), sub: 'Interested Course tasks due today', description: 'Interested Course tasks whose due date is today, assigned to the lead owner, owner not resigned.' },
    { key: 'icOverdue', label: 'IC Till Yesterday', value: formatNumber(grand.icOverdue), sub: 'overdue Interested Course tasks', description: 'Interested Course tasks whose due date has passed.' },
    { key: 'lmToday', label: 'LM Due Today', value: formatNumber(grand.lmToday), sub: 'Lead Master tasks due today', description: 'Lead Master tasks whose due date is today.' },
    { key: 'lmOverdue', label: 'LM Till Yesterday', value: formatNumber(grand.lmOverdue), sub: 'overdue Lead Master tasks', description: 'Lead Master tasks whose due date has passed.' },
    { key: 'total', label: 'Total Pending', value: formatNumber(grand.total), sub: `${formatNumber(grand.icToday + grand.lmToday)} today · ${formatNumber(overdueOf(grand))} overdue`, description: 'All four figures added up.' },
    { key: 'bdes', label: 'Executives With Tasks', value: formatNumber(bdes), sub: bdes ? `${formatNumber(grand.total / bdes, 1)} tasks each on average` : undefined, description: 'Executives who have at least one pending task in the selected subject.' },
    { key: 'age8p', label: 'Overdue 8+ Days', value: ageKnown ? formatNumber(grand.age8p) : '–', sub: ageKnown ? `${formatNumber(grand.age1_3)} overdue 1–3 d · ${formatNumber(grand.age4_7)} overdue 4–7 d` : 'ageing recorded from the next sync', description: 'Overdue tasks (IC + LM) whose due date is 8 or more days ago.' },
    { key: 'target', label: 'Teams Over Target', value: formatNumber(overTarget.length), sub: `of ${formatNumber(teams.filter((t) => t.bdes > 0).length)} teams · target under ${target} overdue per executive`, description: 'Teams whose overdue tasks per executive with tasks reach the target. Red rows are at twice the target or more.' },
  ];

  const subjectOptions = [{ value: ALL_SUBJECTS, label: 'All subjects' }, ...pending.subjects.map((s) => ({ value: s, label: s }))];
  const colors = theme === 'dark' ? ['#3987e5', '#8fbcf0', '#199e70', '#7fd3b0'] : ['#2a78d6', '#9cc3ee', '#1baf7a', '#8fd9b8'];
  const chartData = teams.map((t) => ({ name: t.label, icToday: t.icToday, icOverdue: t.icOverdue, lmToday: t.lmToday, lmOverdue: t.lmOverdue, total: t.total }));
  const teamOptions = [...new Set([...teams.map((t) => t.team), ...aggregateTeams(execRows).map((t) => t.team)])].sort((a, b) => teamLabel(a).localeCompare(teamLabel(b))).map((t) => ({ value: t, label: teamLabel(t) }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-card dark:border-line-dark dark:bg-surface-dark">
        <div className="text-xs text-ink-secondary dark:text-ink-dark-secondary">
          <span className="font-medium text-ink dark:text-ink-dark">Pending Tasks (Sales Overdue)</span> · snapshot of the CRM task list for <span className="font-medium text-ink dark:text-ink-dark">{formatDate(pending.date)}</span>{pending.asOf ? <> · read {formatTimestampIST(pending.asOf)}</> : null}
          <div className="mt-0.5 text-ink-muted">{rule === 'all' ? 'Every task in the ic and lm tabs, by the owner\'s team, the same as filtering the tab by team.' : 'Only tasks assigned to the lead\'s owner whose owner has not resigned, the rule used by some rows of the sheet\'s DB tab.'}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented ariaLabel="Counting rule" value={rule} onChange={setRule} options={[{ value: 'owner', label: 'Assigned to owner only' }, { value: 'all', label: 'All tasks in the tab' }]} />
          <Segmented ariaLabel="Subject" value={subject} onChange={setSubject} options={subjectOptions} />
          <label className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-plane px-2 text-xs text-ink-secondary dark:border-line-dark dark:bg-plane-dark dark:text-ink-dark-secondary" title="Teams and executives at this many overdue tasks per executive turn amber; at twice this, red">
            Target: under
            <input type="number" min={1} max={999} value={target} onChange={(e) => { const n = Number(e.target.value); if (n > 0) setTarget(n); }} aria-label="Overdue tasks per executive target" className="tabular h-6 w-12 rounded border border-line bg-surface px-1 text-right text-xs text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark" />
            overdue / executive
          </label>
        </div>
      </div>

      <section aria-label="Pending overview">
        <div className="mb-2 flex items-baseline justify-between"><h2 className="text-sm font-semibold text-ink dark:text-ink-dark">Overview</h2><span className="text-xs text-ink-muted">{subject === ALL_SUBJECTS ? 'all subjects' : subject}</span></div>
        <KPIGrid kpis={kpis} />
      </section>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="By BDM team" subtitle={`Pending tasks per team · click a team to see its executives · amber at ${target} overdue per executive, red at ${target * 2}`} bodyClassName="!px-0 !py-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-surface dark:bg-surface-dark">
                <GroupHeader extra={['bdes']} trailing={2} />
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted dark:border-line-dark">
                  <th className="px-3 py-2 font-medium">Team</th>
                  <th className="px-3 py-2 text-right font-medium" title="Executives with at least one pending task">BDEs</th>
                  {COLS.map((c) => <th key={c.key} className="px-3 py-2 text-right font-medium">{c.label}</th>)}
                  {AGE_COLS.map((c) => <th key={c.key} className="px-3 py-2 text-right font-medium" title={c.title}>{c.label}</th>)}
                  <th className="px-3 py-2 text-right font-medium" title="Overdue tasks divided by executives with tasks">Overdue / BDE</th>
                  <th className="px-3 py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-line bg-plane/60 font-semibold dark:border-line-dark dark:bg-plane-dark/60">
                  <td className="px-3 py-1.5 text-ink dark:text-ink-dark">Total</td>
                  <Cell n={bdes} strong />
                  {COLS.map((c) => <Cell key={c.key} n={grand[c.key]} strong />)}
                  <AgeCells t={grand} />
                  <Cell n={bdes ? overdueOf(grand) / bdes : null} strong />
                  <StatusCell tone={targetTone(overdueOf(grand), bdes, target)} />
                </tr>
                {teams.map((t) => {
                  const tone = targetTone(overdueOf(t), t.bdes, target);
                  return (
                    <tr key={t.team} onClick={() => setTeam(t.team)} className={`cursor-pointer border-b border-line last:border-0 hover:bg-plane dark:border-line-dark dark:hover:bg-plane-dark ${t.team === selectedTeam ? 'bg-accent-soft/60 dark:bg-accent-soft-dark/40' : ROW_TONE[tone]}`}>
                      <td className="px-3 py-1.5 text-ink dark:text-ink-dark" title={t.team}>{t.label}</td>
                      <Cell n={t.bdes} />
                      {COLS.map((c) => <Cell key={c.key} n={t[c.key]} strong={c.key === 'total'} />)}
                      <AgeCells t={t} />
                      <Cell n={t.bdes ? overdueOf(t) / t.bdes : null} />
                      <StatusCell tone={tone} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!ageKnown && <p className="px-4 py-2 text-[11px] text-ink-muted">Overdue age is recorded from the next sync onwards; this snapshot was taken before that.</p>}
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
          subtitle={`${q ? `${formatNumber(owners.length)} executives matching "${query.trim()}" across all teams` : selectedTeam ? `${teamLabel(selectedTeam)} · ${formatNumber(owners.length)} executives with pending tasks` : 'Pick a team'} · every task of the executive, resigned executives left out, as in the sheet's per-executive block · click a name for details`}
          actions={<><SearchInput value={query} onChange={setQuery} placeholder="Search executive…" className="w-48" /><Select ariaLabel="Team" value={selectedTeam} onChange={(v) => { setTeam(v); setQuery(''); }} options={teamOptions} /></>}
          bodyClassName="!px-0 !py-0"
        >
          <div className="max-h-[32rem] overflow-auto scroll-thin">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="sticky top-0 bg-surface dark:bg-surface-dark">
                <GroupHeader extra={q ? ['team'] : undefined} trailing={1} />
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted dark:border-line-dark">
                  <th className="px-3 py-2 font-medium">Executive</th>
                  {q && <th className="px-3 py-2 font-medium">Team</th>}
                  {COLS.map((c) => <th key={c.key} className="px-3 py-2 text-right font-medium">{c.label}</th>)}
                  {AGE_COLS.map((c) => <th key={c.key} className="px-3 py-2 text-right font-medium" title={c.title}>{c.label}</th>)}
                  <th className="px-3 py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-line bg-plane/60 font-semibold dark:border-line-dark dark:bg-plane-dark/60">
                  <td className="px-3 py-1.5 text-ink dark:text-ink-dark">Total</td>
                  {q && <td />}
                  {COLS.map((c) => <Cell key={c.key} n={ownersTotal[c.key]} strong />)}
                  <AgeCells t={ownersTotal} />
                  <StatusCell tone={targetTone(overdueOf(ownersTotal), owners.length, target)} />
                </tr>
                {owners.map((o) => {
                  const tone = targetTone(overdueOf(o), 1, target);
                  const active = picked?.team === o.team && picked?.owner === o.owner;
                  return (
                    <tr key={`${o.team}|${o.owner}`} onClick={() => setPicked(active ? null : { team: o.team, owner: o.owner })} className={`cursor-pointer border-b border-line last:border-0 hover:bg-plane dark:border-line-dark dark:hover:bg-plane-dark ${active ? 'bg-accent-soft/60 dark:bg-accent-soft-dark/40' : ROW_TONE[tone]}`}>
                      <td className="px-3 py-1.5 font-medium text-ink dark:text-ink-dark">{o.owner}</td>
                      {q && <td className="px-3 py-1.5 text-ink-secondary dark:text-ink-dark-secondary">{teamLabel(o.team)}</td>}
                      {COLS.map((c) => <Cell key={c.key} n={o[c.key]} strong={c.key === 'total'} />)}
                      <AgeCells t={o} />
                      <StatusCell tone={tone} />
                    </tr>
                  );
                })}
                {owners.length === 0 && <tr><td colSpan={11} className="px-3 py-6 text-center text-xs text-ink-muted">{q ? 'No executive with pending tasks matches that name.' : 'No pending tasks for this team and subject.'}</td></tr>}
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

      {picked && <ExecutiveDrilldown pending={pending} dataset={dataset} team={picked.team} owner={picked.owner} onClose={() => setPicked(null)} />}

      {pending.notes.length > 0 && (
        <div className="rounded-lg border border-line bg-surface px-4 py-3 text-xs text-ink-secondary dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark-secondary">
          <div className="mb-1 font-medium text-ink dark:text-ink-dark">How the sheet was read</div>
          <ul className="list-disc space-y-0.5 pl-4">{pending.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
