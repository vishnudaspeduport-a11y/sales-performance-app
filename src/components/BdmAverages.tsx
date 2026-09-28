import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatDate, formatRange } from '../lib/dates';
import { formatDuration, formatNumber } from '../lib/format';
import type { Analytics } from '../state/useAnalytics';
import type { DailyRecord } from '../types';
import { Card } from './ui/Card';

/**
 * "BDM Wise" averages, laid out like the BDM Wise table of the Input DB sheet (DB_1, columns O to AM):
 * for each BDM the number of executives counted and the average per executive of dialed, connected
 * and talk time, outgoing and incoming, followed by the company-wide line "Total Eduport Avg".
 *
 * Who counts comes from icku attendance, not from the sheet's "more than 20 dialed" rule: the team's
 * totals are divided by the executives marked present (present, late or half day), the same base as
 * Avg Calls / BDE on the BDM cards. Over several days present is counted per day, so the figures read
 * as "per present executive per day".
 */
const UNASSIGNED = '(Unassigned)';

type Key = 'count' | 'dialed' | 'dialedConnected' | 'talkDialed' | 'incoming' | 'incomingConnected' | 'talkIncoming' | 'connected' | 'talk';

interface Row {
  name: string;
  /** executives marked present in attendance, counted per day; null when the period has no attendance */
  count: number | null;
  dialed: number | null;
  dialedConnected: number | null;
  talkDialed: number | null;
  incoming: number | null;
  incomingConnected: number | null;
  talkIncoming: number | null;
  connected: number | null;
  talk: number | null;
}

const COLS: { key: Key; label: string; kind: 'count' | 'avg' | 'time'; group?: 'Outgoing' | 'Incoming' | 'Total' }[] = [
  { key: 'count', label: 'Present BDEs', kind: 'count' },
  { key: 'dialed', label: 'Dialed', kind: 'avg', group: 'Outgoing' },
  { key: 'dialedConnected', label: 'Dialed - Connected', kind: 'avg', group: 'Outgoing' },
  { key: 'talkDialed', label: 'Talk Time Dialed', kind: 'time', group: 'Outgoing' },
  { key: 'incoming', label: 'Incoming', kind: 'avg', group: 'Incoming' },
  { key: 'incomingConnected', label: 'Incoming - Connected', kind: 'avg', group: 'Incoming' },
  { key: 'talkIncoming', label: 'Talk Time Incoming', kind: 'time', group: 'Incoming' },
  { key: 'connected', label: 'Total Connected', kind: 'avg', group: 'Total' },
  { key: 'talk', label: 'Total Talk Time', kind: 'time', group: 'Total' },
];

function summarise(name: string, records: DailyRecord[], present: number | null): Row {
  const avg = (f: (r: DailyRecord) => number) => (present ? records.reduce((s, r) => s + f(r), 0) / present : null);
  return {
    name, count: present,
    dialed: avg((r) => r.dialed), dialedConnected: avg((r) => r.dialedConnected), talkDialed: avg((r) => r.talkTimeDialed),
    incoming: avg((r) => r.incoming), incomingConnected: avg((r) => r.incomingConnected), talkIncoming: avg((r) => r.talkTimeIncoming),
    connected: avg((r) => r.dialedConnected + r.incomingConnected), talk: avg((r) => r.talkTimeDialed + r.talkTimeIncoming),
  };
}

const show = (v: number | null, kind: 'count' | 'avg' | 'time') => (v == null ? '–' : kind === 'time' ? formatDuration(v) : kind === 'count' ? formatNumber(v) : formatNumber(v, 1));

export function BdmAverages({ a, present, presentAll, onOpen }: {
  a: Analytics;
  /** present executives per BDM from icku attendance (per day, added up); null values when the period has none */
  present: Map<string, number | null>;
  presentAll: number | null;
  onOpen?: (manager: string) => void;
}) {
  const [sort, setSort] = useState<{ key: Key | 'name'; dir: 'asc' | 'desc' }>({ key: 'talk', dir: 'desc' });
  const { rows, all } = useMemo(() => {
    const by = new Map<string, DailyRecord[]>();
    for (const r of a.records) {
      const m = a.dataset.employeeById.get(r.empId)?.manager || UNASSIGNED;
      const arr = by.get(m); if (arr) arr.push(r); else by.set(m, [r]);
    }
    return { rows: [...by.entries()].map(([m, recs]) => summarise(m, recs, present.get(m) ?? null)), all: summarise('Total Eduport Avg', a.records, presentAll) };
  }, [a, present, presentAll]);
  const sorted = useMemo(() => [...rows].sort((x, y) => {
    if (sort.key === 'name') return sort.dir === 'asc' ? x.name.localeCompare(y.name) : y.name.localeCompare(x.name);
    const vx = x[sort.key]; const vy = y[sort.key];
    if (vx == null && vy == null) return x.name.localeCompare(y.name);
    if (vx == null) return 1;
    if (vy == null) return -1;
    return sort.dir === 'asc' ? vx - vy : vy - vx;
  }), [rows, sort]);
  if (!rows.length) return null;

  const multiDay = a.range.from !== a.range.to;
  const firstDay = a.dataset.attendance?.firstDay ?? null;
  const noAttendance = presentAll == null;
  const toggle = (key: Key | 'name') => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));
  const arrow = (key: Key | 'name') => (sort.key === key ? (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />);
  const groupTone: Record<string, string> = { Outgoing: 'bg-[#2a78d6]/10 text-[#184f95] dark:text-[#9ec5f4]', Incoming: 'bg-[#1baf7a]/10 text-[#0b6b49] dark:text-[#7ad9b5]', Total: 'bg-[#eda100]/10 text-[#7a5200] dark:text-[#f2c45f]' };
  const cells = (r: Row, strong: boolean) => COLS.map((c) => (
    <td key={c.key} className={`tabular whitespace-nowrap px-2 py-1.5 text-right text-ink dark:text-ink-dark ${strong ? 'font-semibold' : ''}`}>{show(r[c.key], c.kind)}</td>
  ));

  return (
    <Card title="BDM Wise Averages" subtitle={`Average per present executive${multiDay ? ' per day' : ''} · ${formatRange(a.range.from, a.range.to)} · present as marked in icku attendance`} bodyClassName="!px-0 !py-0">
      <div className="overflow-x-auto scroll-thin">
        <table className="w-full min-w-[1040px] text-xs">
          <thead>
            <tr className="text-[10px] font-semibold uppercase tracking-wider">
              <th colSpan={3} />
              <th colSpan={3} className={`px-2 py-1 text-center ${groupTone.Outgoing}`}>Outgoing</th>
              <th colSpan={3} className={`px-2 py-1 text-center ${groupTone.Incoming}`}>Incoming</th>
              <th colSpan={2} className={`px-2 py-1 text-center ${groupTone.Total}`}>Total</th>
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
      <p className="border-t border-line px-4 py-2 text-[11px] text-ink-muted dark:border-line-dark">
        Laid out like the BDM Wise table of the Input DB sheet. Present BDEs is the executives marked present, late or half day in icku attendance{multiDay ? ', counted per day and added up' : ''}; each average is the team's total divided by that count, the same base as Avg Calls / BDE on the cards above.{noAttendance ? ` This period has no attendance${firstDay ? `, which starts ${formatDate(firstDay)}` : ''}, so no average can be shown.` : ''} Dialed and Incoming count every call, where the sheet counts each number once. Incoming includes missed and rejected calls.
      </p>
    </Card>
  );
}
