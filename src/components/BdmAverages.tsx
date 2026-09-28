import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { addDays, formatDate, formatRange } from '../lib/dates';
import { formatDuration, formatNumber } from '../lib/format';
import type { Analytics } from '../state/useAnalytics';
import type { DailyRecord } from '../types';
import { Card } from './ui/Card';

/**
 * "BDM Wise" averages, laid out like the BDM Wise table of the Input DB sheet (DB_1, columns O to AM):
 * for each BDM the executives counted and the average per executive of dialed, connected and talk
 * time, outgoing and incoming, followed by the company-wide line "Total Eduport Avg".
 *
 * Counting follows the sheet: Dialed, Incoming and the connected columns count each phone number
 * once per executive per day. Who counts does not follow the sheet's "more than 20 dialed" rule:
 * the team's totals are divided by the executives marked present in icku attendance (present, late
 * or half day). Only days that have both the unique-number counts and attendance enter the table.
 */
const UNASSIGNED = '(Unassigned)';

type Key = 'count' | 'dialed' | 'dialedConnected' | 'talkDialed' | 'incoming' | 'incomingConnected' | 'talkIncoming' | 'connected' | 'talk';

interface Row {
  name: string;
  /** executives marked present in attendance, counted per day */
  count: number;
  dialed: number | null;
  dialedConnected: number | null;
  talkDialed: number | null;
  incoming: number | null;
  incomingConnected: number | null;
  talkIncoming: number | null;
  connected: number | null;
  talk: number | null;
}

interface Sums { dialed: number; dialedConnected: number; talkDialed: number; incoming: number; incomingConnected: number; talkIncoming: number }

const COLS: { key: Key; label: string; kind: 'count' | 'avg' | 'time' }[] = [
  { key: 'count', label: 'Present BDEs', kind: 'count' },
  { key: 'dialed', label: 'Dialed', kind: 'avg' },
  { key: 'dialedConnected', label: 'Dialed - Connected', kind: 'avg' },
  { key: 'talkDialed', label: 'Talk Time Dialed', kind: 'time' },
  { key: 'incoming', label: 'Incoming', kind: 'avg' },
  { key: 'incomingConnected', label: 'Incoming - Connected', kind: 'avg' },
  { key: 'talkIncoming', label: 'Talk Time Incoming', kind: 'time' },
  { key: 'connected', label: 'Total Connected', kind: 'avg' },
  { key: 'talk', label: 'Total Talk Time', kind: 'time' },
];

const emptySums = (): Sums => ({ dialed: 0, dialedConnected: 0, talkDialed: 0, incoming: 0, incomingConnected: 0, talkIncoming: 0 });

function toRow(name: string, s: Sums, present: number): Row {
  const avg = (v: number) => (present ? v / present : null);
  return {
    name, count: present,
    dialed: avg(s.dialed), dialedConnected: avg(s.dialedConnected), talkDialed: avg(s.talkDialed),
    incoming: avg(s.incoming), incomingConnected: avg(s.incomingConnected), talkIncoming: avg(s.talkIncoming),
    connected: avg(s.dialedConnected + s.incomingConnected), talk: avg(s.talkDialed + s.talkIncoming),
  };
}

const show = (v: number | null, kind: 'count' | 'avg' | 'time') => (v == null ? '–' : kind === 'time' ? formatDuration(v) : kind === 'count' ? formatNumber(v) : formatNumber(v, 1));

export function BdmAverages({ a, onOpen }: { a: Analytics; onOpen?: (manager: string) => void }) {
  const [sort, setSort] = useState<{ key: Key | 'name'; dir: 'asc' | 'desc' }>({ key: 'talk', dir: 'desc' });
  const att = a.dataset.attendance;
  const unique = a.dataset.unique;

  const built = useMemo(() => {
    // Days of the period that can be counted: attendance exists, and so do the unique-number counts.
    const days: string[] = [];
    let guard = 0;
    for (let d = a.range.from; d <= a.range.to && guard < 1000; d = addDays(d, 1), guard++) {
      if (!att || !att.firstDay || d < att.firstDay || d > att.to) continue;
      if (unique && !unique.dates.has(d)) continue;
      days.push(d);
    }
    const daySet = new Set(days);
    const dirManager = new Map(a.dataset.directory.map((d) => [d.empNo, d.managerName]));
    const managerOf = (id: string) => a.dataset.employeeById.get(id)?.manager || dirManager.get(id) || UNASSIGNED;

    const sums = new Map<string, Sums>();
    const total = emptySums();
    const add = (s: Sums, r: DailyRecord) => {
      const u = unique ? unique.counts.get(`${r.date}|${r.empId}`) : undefined;
      s.dialed += unique ? (u ? u[0] : 0) : r.dialed;
      s.dialedConnected += unique ? (u ? u[1] : 0) : r.dialedConnected;
      s.incoming += unique ? (u ? u[2] : 0) : r.incoming;
      s.incomingConnected += unique ? (u ? u[3] : 0) : r.incomingConnected;
      s.talkDialed += r.talkTimeDialed;
      s.talkIncoming += r.talkTimeIncoming;
    };
    for (const r of a.records) {
      if (!daySet.has(r.date)) continue;
      const m = managerOf(r.empId);
      let s = sums.get(m);
      if (!s) { s = emptySums(); sums.set(m, s); }
      add(s, r); add(total, r);
    }

    // Present executives per BDM on those days; the filters above apply here too.
    const scoped = new Set(a.employees.map((e) => e.id));
    const only = a.filters.employees.length ? new Set(a.filters.employees) : null;
    const present = new Map<string, number>();
    if (att) for (const d of days) {
      const ids = att.present.get(d);
      if (!ids) continue;
      for (const id of ids) {
        if (only && !only.has(id)) continue;
        if (a.dataset.employeeById.has(id) && !scoped.has(id)) continue;
        const m = managerOf(id);
        present.set(m, (present.get(m) ?? 0) + 1);
      }
    }
    const rows = [...sums.entries()].map(([m, s]) => toRow(m, s, present.get(m) ?? 0));
    // The company line counts the present executives of the BDMs listed, so it matches the rows under it.
    const all = toRow('Total Eduport Avg', total, rows.reduce((n, r) => n + r.count, 0));
    return { rows, all, days };
  }, [a, att, unique]);

  const sorted = useMemo(() => [...built.rows].sort((x, y) => {
    if (sort.key === 'name') return sort.dir === 'asc' ? x.name.localeCompare(y.name) : y.name.localeCompare(x.name);
    const vx = x[sort.key]; const vy = y[sort.key];
    if (vx == null && vy == null) return x.name.localeCompare(y.name);
    if (vx == null) return 1;
    if (vy == null) return -1;
    return sort.dir === 'asc' ? vx - vy : vy - vx;
  }), [built.rows, sort]);

  const multiDay = a.range.from !== a.range.to;
  const { days, all } = built;
  const partial = days.length > 0 && (days[0] !== a.range.from);
  const toggle = (key: Key | 'name') => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));
  const arrow = (key: Key | 'name') => (sort.key === key ? (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />);
  const groupTone = { out: 'bg-[#2a78d6]/10 text-[#184f95] dark:text-[#9ec5f4]', inc: 'bg-[#1baf7a]/10 text-[#0b6b49] dark:text-[#7ad9b5]', tot: 'bg-[#eda100]/10 text-[#7a5200] dark:text-[#f2c45f]' };
  const cells = (r: Row, strong: boolean) => COLS.map((c) => (
    <td key={c.key} className={`tabular whitespace-nowrap px-2 py-1.5 text-right text-ink dark:text-ink-dark ${strong ? 'font-semibold' : ''}`}>{show(r[c.key], c.kind)}</td>
  ));
  const why = !att ? 'Attendance is not connected.' : !days.length
    ? `This period has no day with both attendance and unique-number counts.${att.firstDay ? ` Attendance starts ${formatDate(att.firstDay)}.` : ''}${unique && unique.first ? ` Unique-number counts start ${formatDate(unique.first)}.` : ''}`
    : '';

  return (
    <Card title="BDM Wise Averages" subtitle={`Average per present executive${multiDay ? ' per day' : ''} · ${days.length ? formatRange(days[0], days[days.length - 1]) : formatRange(a.range.from, a.range.to)} · each number counted once${unique ? '' : ' (not yet available: every call counted)'}`} bodyClassName="!px-0 !py-0">
      {!days.length ? (
        <p className="px-4 py-6 text-center text-sm text-ink-muted">{why}</p>
      ) : (
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full min-w-[1040px] text-xs">
            <thead>
              <tr className="text-[10px] font-semibold uppercase tracking-wider">
                <th colSpan={3} />
                <th colSpan={3} className={`px-2 py-1 text-center ${groupTone.out}`}>Outgoing</th>
                <th colSpan={3} className={`px-2 py-1 text-center ${groupTone.inc}`}>Incoming</th>
                <th colSpan={2} className={`px-2 py-1 text-center ${groupTone.tot}`}>Total</th>
              </tr>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted dark:border-line-dark">
                <th scope="col" className="w-10 px-2 py-1.5 text-right font-medium">#</th>
                <th scope="col" className="sticky left-0 z-10 bg-surface px-2 py-1.5 font-medium dark:bg-surface-dark"><button type="button" onClick={() => toggle('name')} className="inline-flex items-center gap-1 hover:text-ink dark:hover:text-ink-dark">BDM{arrow('name')}</button></th>
                {COLS.map((c) => (
                  <th key={c.key} scope="col" className="px-2 py-1.5 text-right font-medium">
                    <button type="button" onClick={() => toggle(c.key)} className="inline-flex flex-row-reverse items-center gap-1 hover:text-ink dark:hover:text-ink-dark" aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>{c.label}{arrow(c.key)}</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-line bg-accent-soft/40 dark:border-line-dark dark:bg-accent-soft-dark/30">
                <td className="px-2 py-1.5" />
                <td className="sticky left-0 z-10 whitespace-nowrap bg-inherit px-2 py-1.5 font-semibold text-ink dark:text-ink-dark">Total Eduport Avg</td>
                {cells(all, true)}
              </tr>
              {sorted.map((r, i) => (
                <tr key={r.name} className="border-b border-line last:border-0 hover:bg-plane/60 dark:border-line-dark dark:hover:bg-[#202020]">
                  <td className="tabular px-2 py-1.5 text-right text-ink-muted">{i + 1}</td>
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-surface px-2 py-1.5 dark:bg-surface-dark">
                    {onOpen ? <button type="button" onClick={() => onOpen(r.name)} className="font-medium text-ink hover:text-accent hover:underline dark:text-ink-dark">{r.name}</button> : <span className="font-medium text-ink dark:text-ink-dark">{r.name}</span>}
                  </td>
                  {cells(r, false)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-line px-4 py-2 text-[11px] text-ink-muted dark:border-line-dark">
        Laid out like the BDM Wise table of the Input DB sheet. Dialed, Incoming and the connected columns count each phone number once per executive per day, as the sheet does; Incoming includes missed and rejected calls. Present BDEs is the executives marked present, late or half day in icku attendance{multiDay ? ', counted per day and added up' : ''}, and each average is the team's total divided by that count.{partial ? ` Counted from ${formatDate(days[0])}, the first day of the period with both attendance and unique-number counts.` : ''}
      </p>
    </Card>
  );
}
