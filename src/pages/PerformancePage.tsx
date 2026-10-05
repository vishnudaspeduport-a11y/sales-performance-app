import { AlertTriangle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KPIGrid, type KPI } from '../components/KPICard';
import { Card } from '../components/ui/Card';
import { Badge, Button, SearchInput, Segmented, Select } from '../components/ui/Controls';
import { EmptyState } from '../components/ui/States';
import { WhatsAppImageButton } from '../components/WhatsAppImageButton';
import { employeePhonesGet } from '../lib/api';
import { addDays, formatDate, formatTimestampIST, isIsoDate, todayIST } from '../lib/dates';
import { formatDuration, formatNumber } from '../lib/format';
import { useData } from '../state/DataContext';
import { useView } from '../state/ViewContext';
import type { Dataset } from '../types';

/**
 * Performance: who is behind the talk-time targets.
 *  - By 4 PM on the chosen day: at least 1 h 15 m of talk time AND at least 10 calls of 3 minutes or
 *    more, counting only calls that started before 4 PM. Anyone missing either one is listed.
 *  - The day before (the last day with calls before the chosen one): at least 2 h 45 m of talk time
 *    for the whole day.
 * The people checked are the executives marked present in icku attendance that day, plus anyone who
 * made a call. Phone numbers come from an admin-only request and are not part of the dashboard data.
 */
const DAY_TARGET = 2 * 3600 + 45 * 60;
const CUTOFF_TARGET = 75 * 60;
const LONG_CALLS_TARGET = 10;
const UNASSIGNED = '(Unassigned)';

interface Person { id: string; name: string; manager: string; talk: number; long: number; present: boolean }
type SortKey = 'talk' | 'manager' | 'name';

const clock = (minutes: number) => { const h = Math.floor(minutes / 60); const m = minutes % 60; return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

function PeopleTable({ people, phones, showLong, showPhone, empty }: { people: (Person & { missed?: string[] })[]; phones: Record<string, string> | null; showLong: boolean; showPhone: boolean; empty: string }) {
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="zebra w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted dark:border-line-dark">
            <th className="w-10 px-3 py-2 text-right font-medium">#</th>
            <th className="px-3 py-2 font-medium">EP ID</th>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Manager</th>
            {showPhone && <th className="px-3 py-2 font-medium">Phone</th>}
            <th className="px-3 py-2 text-right font-medium">Talk Time</th>
            {showLong && <th className="px-3 py-2 text-right font-medium">Calls of 3 min+</th>}
            <th className="px-3 py-2 text-right font-medium">Short By</th>
            {showLong && <th className="px-3 py-2 font-medium">Missed</th>}
          </tr>
        </thead>
        <tbody>
          {people.map((p, i) => (
            <tr key={p.id} className="border-b border-line last:border-0 dark:border-line-dark">
              <td className="tabular px-3 py-1.5 text-right text-ink-muted">{i + 1}</td>
              <td className="tabular whitespace-nowrap px-3 py-1.5 text-ink-secondary dark:text-ink-dark-secondary">{p.id}</td>
              <td className="whitespace-nowrap px-3 py-1.5 font-medium text-ink dark:text-ink-dark">{p.name}{!p.present && <span className="ml-2 text-[11px] font-normal text-ink-muted" title="Made calls but is not marked present in icku attendance">not marked present</span>}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-ink-secondary dark:text-ink-dark-secondary">{p.manager}</td>
              {showPhone && <td className="tabular whitespace-nowrap px-3 py-1.5 text-ink-secondary dark:text-ink-dark-secondary">{phones?.[p.id] ?? '–'}</td>}
              <td className={`tabular whitespace-nowrap px-3 py-1.5 text-right font-semibold ${p.talk === 0 ? 'text-status-critical' : 'text-ink dark:text-ink-dark'}`}>{formatDuration(p.talk)}</td>
              {showLong && <td className="tabular px-3 py-1.5 text-right text-ink dark:text-ink-dark">{formatNumber(p.long)}</td>}
              <td className="tabular whitespace-nowrap px-3 py-1.5 text-right text-ink-secondary dark:text-ink-dark-secondary">{(() => { const short = (showLong ? CUTOFF_TARGET : DAY_TARGET) - p.talk; return short > 0 ? formatDuration(short) : '–'; })()}</td>
              {showLong && <td className="whitespace-nowrap px-3 py-1.5"><span className="flex flex-wrap gap-1">{(p.missed ?? []).map((m) => <Badge key={m} tone={m === 'Talk time' ? 'critical' : 'warning'}>{m}</Badge>)}</span></td>}
            </tr>
          ))}
          {people.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-xs text-ink-muted">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function PerformancePage({ dataset }: { dataset: Dataset }) {
  const { view } = useView();
  const { lastUpdated } = useData();
  const today = todayIST();
  const [date, setDate] = useState(today);
  const [manager, setManager] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('talk');
  const cutoffCard = useRef<HTMLDivElement>(null);
  const dayCard = useRef<HTMLDivElement>(null);

  // Phone numbers: asked from the server for admins only; never in the dashboard data.
  const [phones, setPhones] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    if (view !== 'admin') { setPhones(null); return; }
    let alive = true;
    employeePhonesGet().then((p) => { if (alive) setPhones(p); }).catch(() => { if (alive) setPhones(null); });
    return () => { alive = false; };
  }, [view, lastUpdated]);

  const built = useMemo(() => {
    const dir = new Map(dataset.directory.map((d) => [d.empNo, d]));
    const nameOf = (id: string) => dataset.employeeById.get(id)?.name || dir.get(id)?.name || id;
    const managerOf = (id: string) => dataset.employeeById.get(id)?.manager || dir.get(id)?.managerName || UNASSIGNED;
    const callDates = [...new Set(dataset.records.map((r) => r.date))].sort();
    // "Yesterday" is the last day with calls before the chosen day, so a Monday looks at Saturday when Sunday is off.
    const prev = [...callDates].reverse().find((d) => d < date && d >= addDays(date, -10)) ?? addDays(date, -1);
    const att = dataset.attendance;
    const presentOn = (day: string) => (att && att.firstDay && day >= att.firstDay && day <= att.to ? att.present.get(day) ?? null : null);

    const people = (day: string, value: (id: string) => { talk: number; long: number } | null) => {
      const present = presentOn(day);
      const ids = new Set<string>(present ?? []);
      const totals = new Map<string, number>();
      for (const r of dataset.records) if (r.date === day) { ids.add(r.empId); totals.set(r.empId, (totals.get(r.empId) ?? 0) + r.talkTimeDialed + r.talkTimeIncoming); }
      const list: Person[] = [...ids].map((id) => { const v = value(id); return { id, name: nameOf(id), manager: managerOf(id), talk: v ? v.talk : totals.get(id) ?? 0, long: v ? v.long : 0, present: present ? present.has(id) : true }; });
      return { list, hasAttendance: !!present };
    };

    const cut = dataset.cutoff;
    const hasCutoff = !!cut && cut.dates.has(date);
    const cutoffDay = people(date, (id) => { const c = cut?.byKey.get(`${date}|${id}`); return { talk: c ? c[0] : 0, long: c ? c[1] : 0 }; });
    const prevDay = people(prev, () => null);
    return { prev, hasCutoff, cutoffDay, prevDay, hasPrevCalls: callDates.includes(prev), hasCalls: callDates.includes(date) };
  }, [dataset, date]);

  const managers = useMemo(() => [...new Set([...built.cutoffDay.list, ...built.prevDay.list].map((p) => p.manager))].sort((a, b) => a.localeCompare(b)), [built]);
  const q = query.trim().toLowerCase();
  const scope = (list: Person[]) => list.filter((p) => (!manager || p.manager === manager) && (!q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)));
  const order = <T extends Person>(list: T[]) => [...list].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'manager' ? a.manager.localeCompare(b.manager) || a.talk - b.talk : a.talk - b.talk || a.name.localeCompare(b.name)));

  const cutoffAll = scope(built.cutoffDay.list);
  const cutoffBelow = order(cutoffAll.map((p) => ({ ...p, missed: [...(p.talk < CUTOFF_TARGET ? ['Talk time'] : []), ...(p.long < LONG_CALLS_TARGET ? ['3 min calls'] : [])] })).filter((p) => p.missed.length > 0));
  const dayAll = scope(built.prevDay.list);
  const dayBelow = order(dayAll.filter((p) => p.talk < DAY_TARGET));

  // How far the chosen day's call data runs: the time of its latest call in the log.
  const lastCall = dataset.cutoff?.last.get(date) ?? null;
  const early = date === today && built.hasCutoff && lastCall != null && lastCall < 16 * 60;
  const showPhone = view === 'admin';
  const kpis: KPI[] = [
    { key: 'cutoffBelow', tone: 'red', label: 'Behind at 4 PM', value: built.hasCutoff ? formatNumber(cutoffBelow.length) : '–', sub: built.hasCutoff ? `of ${formatNumber(cutoffAll.length)} executives · ${formatDate(date)}` : 'no 4 PM figures for this day', description: 'Under 1 h 15 m of talk time, or fewer than 10 calls of 3 minutes or more, counting calls that started before 4 PM.' },
    { key: 'cutoffMet', tone: 'green', label: 'On target at 4 PM', value: built.hasCutoff ? formatNumber(cutoffAll.length - cutoffBelow.length) : '–', sub: '1 h 15 m and 10 calls of 3 min+', description: 'At least 1 h 15 m of talk time and at least 10 calls of 3 minutes or more before 4 PM.' },
    { key: 'dayBelow', tone: 'amber', label: 'Below 2 h 45 m', value: built.hasPrevCalls ? formatNumber(dayBelow.length) : '–', sub: built.hasPrevCalls ? `of ${formatNumber(dayAll.length)} executives · ${formatDate(built.prev)}` : `no calls on ${formatDate(built.prev)}`, description: 'Total talk time for the whole of the previous working day under 2 h 45 m.' },
    { key: 'dayMet', tone: 'blue', label: 'Reached 2 h 45 m', value: built.hasPrevCalls ? formatNumber(dayAll.length - dayBelow.length) : '–', sub: `whole day · ${formatDate(built.prev)}`, description: 'Total talk time for the whole of the previous working day of 2 h 45 m or more.' },
  ];

  return (
    <div className="space-y-4">
      <section aria-label="Day" className="rounded-2xl border border-line/70 bg-surface p-3 shadow-card dark:border-line-dark dark:bg-surface-dark sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="performance-date">Day</label>
          <input id="performance-date" type="date" value={date} max={today} onChange={(e) => { if (isIsoDate(e.target.value) && e.target.value >= '2000-01-01') setDate(e.target.value); }} className="h-9 rounded-xl border border-line bg-surface px-2 text-sm text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark" />
          <Button size="sm" onClick={() => setDate(today)} disabled={date === today}>Today</Button>
          <Select ariaLabel="Manager" value={manager} onChange={setManager} options={[{ value: '', label: 'All managers' }, ...managers.map((m) => ({ value: m, label: m }))]} className="w-52" />
          <SearchInput value={query} onChange={setQuery} placeholder="Search name or EP ID…" className="w-56" />
          <span className="ml-auto"><Segmented ariaLabel="Sort" value={sort} onChange={setSort} options={[{ value: 'talk', label: 'Lowest talk time' }, { value: 'manager', label: 'By manager' }, { value: 'name', label: 'By name' }]} /></span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
          <span>4 PM check: <span className="font-medium text-ink-secondary dark:text-ink-dark-secondary">{formatDate(date)}</span></span>
          <span>2 h 45 m check: <span className="font-medium text-ink-secondary dark:text-ink-dark-secondary">{formatDate(built.prev)}</span></span>
          {lastCall != null && <span>Latest call in the data: <span className="font-medium text-ink-secondary dark:text-ink-dark-secondary">{clock(lastCall)}</span></span>}
          <span>Data read {formatTimestampIST(lastUpdated ?? undefined)}</span>
        </div>
      </section>

      {early && (
        <div role="status" className="flex items-start gap-2 rounded-2xl border border-[#f1d9a0] bg-[#fff6dd] px-4 py-2.5 text-xs text-[#7a5200] dark:border-[#4d3a10] dark:bg-[#33270c] dark:text-[#fab219]">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>Today’s call data runs only up to {lastCall != null ? clock(lastCall) : 'earlier today'}, so the 4 PM list is not final yet. Update the sheet after 4 PM and press Refresh Data.</span>
        </div>
      )}

      <KPIGrid kpis={kpis} />

      <div ref={cutoffCard} className="min-w-0">
        <Card
          title={`Behind at 4 PM · ${formatDate(date)}`}
          subtitle={`${formatNumber(cutoffBelow.length)} of ${formatNumber(cutoffAll.length)} executives · under 1 h 15 m of talk time or fewer than 10 calls of 3 min+, before 4 PM${manager ? ` · ${manager}` : ''}`}
          actions={<span data-no-capture className="flex flex-wrap items-center gap-2"><WhatsAppImageButton targetRef={cutoffCard} targetKey="performance:cutoff" filename={`behind-at-4pm-${date}.png`} title={`Behind at 4 PM · ${formatDate(date)}`} /></span>}
          bodyClassName="!px-0 !py-0"
        >
          {built.hasCutoff
            ? <PeopleTable people={cutoffBelow} phones={phones} showLong showPhone={showPhone} empty="Everyone checked is on target at 4 PM." />
            : <EmptyState title="No 4 PM figures for this day" message={built.hasCalls ? 'The 4 PM figures are worked out from the call log on each sync. Press Refresh Data; they appear once that day’s call log has been read.' : `There are no calls for ${formatDate(date)} yet. Update the sheet and press Refresh Data.`} />}
        </Card>
      </div>

      <div ref={dayCard} className="min-w-0">
        <Card
          title={`Below 2 h 45 m · ${formatDate(built.prev)}`}
          subtitle={`${formatNumber(dayBelow.length)} of ${formatNumber(dayAll.length)} executives · total talk time for the whole day under 2 h 45 m${manager ? ` · ${manager}` : ''}`}
          actions={<span data-no-capture className="flex flex-wrap items-center gap-2"><WhatsAppImageButton targetRef={dayCard} targetKey="performance:day" filename={`below-2h45m-${built.prev}.png`} title={`Below 2 h 45 m · ${formatDate(built.prev)}`} /></span>}
          bodyClassName="!px-0 !py-0"
        >
          {built.hasPrevCalls
            ? <PeopleTable people={dayBelow} phones={phones} showLong={false} showPhone={showPhone} empty="Everyone checked reached 2 h 45 m." />
            : <EmptyState title="No calls on that day" message={`There are no call records for ${formatDate(built.prev)}.`} />}
        </Card>
      </div>

      <p className="px-1 text-[11px] leading-relaxed text-ink-muted">
        Checked: executives marked present, late or half day in icku attendance that day, and anyone who made a call. People who were absent and made no call are left out.
        {!built.cutoffDay.hasAttendance && ` Attendance for ${formatDate(date)} is not available, so only people with calls are checked that day.`}
        {!built.prevDay.hasAttendance && built.prev !== date && ` Attendance for ${formatDate(built.prev)} is not available, so only people with calls are checked that day.`}
        {' '}Talk time counts outgoing and incoming calls. The 4 PM figures count calls that started before 4:00 PM.
        {showPhone && phones == null && ' Phone numbers show on the live site for Admin.'}
      </p>
    </div>
  );
}
