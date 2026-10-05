import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, formatDate, formatRange } from '../lib/dates';
import { formatDuration, formatNumber } from '../lib/format';
import { useRouter } from '../state/router';
import type { Analytics } from '../state/useAnalytics';
import { BDM_AVERAGES_KEY, bdmTeamKey } from '../lib/whatsappTargets';
import { Card } from './ui/Card';
import { WhatsAppGroupsButton, WhatsAppImageButton } from './WhatsAppImageButton';
import { Select } from './ui/Controls';

/**
 * Team Wise Report, laid out like the team table of the Input DB sheet (DB_1, columns A to L):
 * choose a manager and every executive under them is listed with dialed, connected and talk time,
 * outgoing and incoming, and the totals. Counting follows the sheet: each phone number once per
 * executive per day (where the unique-number counts exist; every call on older days).
 * The call-length columns split Total Connected, each connected number placed by its longest call that day. Executives marked present in icku attendance are listed even when they made no calls.
 */
const UNASSIGNED = '(Unassigned)';

type Key = 'name' | 'dialed' | 'dialedConnected' | 'talkDialed' | 'incoming' | 'incomingConnected' | 'talkIncoming' | 'connected' | 'talk' | 'band02' | 'band24' | 'band4p';

interface Row {
  id: string;
  name: string;
  /** days marked present in the period; null when the period has no attendance */
  present: number | null;
  days: number;
  dialed: number;
  dialedConnected: number;
  talkDialed: number;
  incoming: number;
  incomingConnected: number;
  talkIncoming: number;
  connected: number;
  talk: number;
  /** connected numbers by the length of the call: up to 2 min, 2 to 4 min, over 4 min */
  band02: number;
  band24: number;
  band4p: number;
}

const COLS: { key: Exclude<Key, 'name'>; label: string; kind: 'count' | 'time' }[] = [
  { key: 'dialed', label: 'Dialed', kind: 'count' },
  { key: 'dialedConnected', label: 'Dialed - Connected', kind: 'count' },
  { key: 'talkDialed', label: 'Talk Time Dialed', kind: 'time' },
  { key: 'incoming', label: 'Incoming', kind: 'count' },
  { key: 'incomingConnected', label: 'Incoming - Connected', kind: 'count' },
  { key: 'talkIncoming', label: 'Talk Time Incoming', kind: 'time' },
  { key: 'connected', label: 'Total Connected', kind: 'count' },
  { key: 'talk', label: 'Total Talk Time', kind: 'time' },
  { key: 'band02', label: '0–2 min', kind: 'count' },
  { key: 'band24', label: '2–4 min', kind: 'count' },
  { key: 'band4p', label: 'Over 4 min', kind: 'count' },
];

const blank = (id: string, name: string): Row => ({ id, name, present: null, days: 0, dialed: 0, dialedConnected: 0, talkDialed: 0, incoming: 0, incomingConnected: 0, talkIncoming: 0, connected: 0, talk: 0, band02: 0, band24: 0, band4p: 0 });
const show = (v: number, kind: 'count' | 'time') => (kind === 'time' ? formatDuration(v) : formatNumber(v));

export function TeamWiseReport({ a }: { a: Analytics }) {
  const { navigate } = useRouter();
  const att = a.dataset.attendance;
  const unique = a.dataset.unique;
  const [sort, setSort] = useState<{ key: Key; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });
  const card = useRef<HTMLDivElement>(null);

  const { managerOf, nameOf } = useMemo(() => {
    const dir = new Map(a.dataset.directory.map((d) => [d.empNo, d]));
    return {
      managerOf: (id: string) => a.dataset.employeeById.get(id)?.manager || dir.get(id)?.managerName || UNASSIGNED,
      nameOf: (id: string) => a.dataset.employeeById.get(id)?.name || dir.get(id)?.name || id,
    };
  }, [a.dataset]);

  // Managers with activity in the period, busiest first.
  const managers = useMemo(() => {
    const calls = new Map<string, number>();
    for (const r of a.records) { const m = managerOf(r.empId); calls.set(m, (calls.get(m) ?? 0) + r.dialed + r.incoming); }
    return [...calls.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([m]) => m);
  }, [a.records, managerOf]);

  const filtered = a.filters.dims.manager ?? [];
  const [manager, setManager] = useState<string>('');
  // Follow the Manager filter at the top when it names one manager; otherwise keep the choice made here.
  useEffect(() => {
    if (filtered.length === 1 && managers.includes(filtered[0])) setManager(filtered[0]);
    else if (!managers.includes(manager)) setManager(managers[0] ?? '');
  }, [filtered, managers, manager]);

  const built = useMemo(() => {
    const rows = new Map<string, Row>();
    let fallbackDays = 0; const seenFallback = new Set<string>();
    for (const r of a.records) {
      if (managerOf(r.empId) !== manager) continue;
      let row = rows.get(r.empId);
      if (!row) { row = blank(r.empId, nameOf(r.empId)); rows.set(r.empId, row); }
      const counted = unique && unique.dates.has(r.date);
      const u = counted ? unique.counts.get(`${r.date}|${r.empId}`) : undefined;
      if (!counted && !seenFallback.has(r.date)) { seenFallback.add(r.date); fallbackDays++; }
      row.dialed += counted ? (u ? u[0] : 0) : r.dialed;
      row.dialedConnected += counted ? (u ? u[1] : 0) : r.dialedConnected;
      row.incoming += counted ? (u ? u[2] : 0) : r.incoming;
      row.incomingConnected += counted ? (u ? u[3] : 0) : r.incomingConnected;
      row.talkDialed += r.talkTimeDialed;
      row.talkIncoming += r.talkTimeIncoming;
      // Call length: each connected number once, by its longest call that day (the calls themselves on older days).
      row.band02 += (counted ? r.uqBand02 : r.band02) ?? 0;
      row.band24 += (counted ? r.uqBand24 : r.band24) ?? 0;
      row.band4p += (counted ? r.uqBand4p : r.band4p) ?? 0;
      row.days++;
    }
    // Attendance: days present per executive, and executives present without any call.
    // Counted on the days the call log has, the same days BDM Wise Averages uses.
    const callDays = new Set<string>();
    for (const r of a.dataset.records) if (r.date >= a.range.from && r.date <= a.range.to) callDays.add(r.date);
    let attendanceDays = 0;
    if (att && att.firstDay) {
      const scoped = new Set(a.employees.map((e) => e.id));
      const only = a.filters.employees.length ? new Set(a.filters.employees) : null;
      let guard = 0;
      for (let d = a.range.from < att.firstDay ? att.firstDay : a.range.from; d <= a.range.to && d <= att.to && guard < 1000; d = addDays(d, 1), guard++) {
        if (!callDays.has(d)) continue;
        const ids = att.present.get(d);
        attendanceDays++;
        if (!ids) continue;
        for (const id of ids) {
          if (managerOf(id) !== manager) continue;
          if (only && !only.has(id)) continue;
          if (a.dataset.employeeById.has(id) && !scoped.has(id)) continue;
          let row = rows.get(id);
          if (!row) { row = blank(id, nameOf(id)); rows.set(id, row); }
          row.present = (row.present ?? 0) + 1;
        }
      }
      if (attendanceDays) for (const row of rows.values()) row.present ??= 0;
    }
    // Only the executives marked present are listed (on at least one day of the period). Without attendance for the period, everyone who called is listed.
    const everyone = [...rows.values()];
    const list = attendanceDays ? everyone.filter((r) => (r.present ?? 0) > 0) : everyone;
    const leftOut = everyone.length - list.length;
    for (const r of list) { r.connected = r.dialedConnected + r.incomingConnected; r.talk = r.talkDialed + r.talkIncoming; }
    const total = blank('', 'Team total');
    for (const r of list) for (const c of COLS) total[c.key] += r[c.key];
    total.present = attendanceDays ? list.reduce((n, r) => n + (r.present ?? 0), 0) : null;
    return { list, total, leftOut, fallbackDays, attendanceDays, hasAttendance: attendanceDays > 0 };
  }, [a, att, unique, manager, managerOf, nameOf]);

  const sorted = useMemo(() => [...built.list].sort((x, y) => {
    if (sort.key === 'name') return sort.dir === 'asc' ? x.name.localeCompare(y.name) : y.name.localeCompare(x.name);
    const vx = x[sort.key] ?? -1; const vy = y[sort.key] ?? -1;
    return (sort.dir === 'asc' ? vx - vy : vy - vx) || x.name.localeCompare(y.name);
  }), [built.list, sort]);

  if (!managers.length) return null;
  const multiDay = a.range.from !== a.range.to;
  const toggle = (key: Key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));
  const arrow = (key: Key) => (sort.key === key ? (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />);
  const th = (key: Key, label: string, right = true) => (
    <th key={key} scope="col" className={`px-2 py-1.5 font-medium ${right ? 'text-right' : ''}`}>
      <button type="button" onClick={() => toggle(key)} className={`inline-flex items-center gap-1 hover:text-ink dark:hover:text-ink-dark ${right ? 'flex-row-reverse' : ''}`} aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>{label}{arrow(key)}</button>
    </th>
  );
  const called = built.list.filter((r) => r.days > 0).length;

  return (
    <div ref={card} className="min-w-0">
    <Card
      title="Team Wise Report"
      subtitle={`${manager} · ${built.hasAttendance ? (multiDay ? `${formatNumber(built.list.length)} executives present on at least one of ${formatNumber(built.attendanceDays)} days` : `${formatNumber(built.list.length)} executives present`) : `${formatNumber(built.list.length)} executives`} · ${formatNumber(called)} made calls · ${formatRange(a.range.from, a.range.to)}`}
      actions={<span data-no-capture className="flex flex-wrap items-center gap-2"><WhatsAppGroupsButton rows={[{ key: BDM_AVERAGES_KEY, label: 'BDM Wise Averages' }, ...[...managers].sort((x, y) => x.localeCompare(y)).map((m) => ({ key: bdmTeamKey(m), label: `Team Wise Report · ${m}` }))]} /><WhatsAppImageButton targetRef={card} targetKey={bdmTeamKey(manager)} filename={`team-${manager.replace(/\s+/g, '-').toLowerCase()}-${a.range.from}.png`} title={`${manager} · Team Wise Report`} /><Select ariaLabel="Manager" value={manager} onChange={setManager} options={managers.map((m) => ({ value: m, label: m }))} className="w-56" /></span>}
      bodyClassName="!px-0 !py-0"
    >
      <div className="overflow-x-auto scroll-thin">
        <table className="w-full min-w-[1220px] text-xs">
          <thead>
            <tr className="text-[10px] font-semibold uppercase tracking-wider">
              <th colSpan={3} />
              <th colSpan={3} className="bg-[#2a78d6]/10 px-2 py-1 text-center text-[#184f95] dark:text-[#9ec5f4]">Outgoing</th>
              <th colSpan={3} className="bg-[#1baf7a]/10 px-2 py-1 text-center text-[#0b6b49] dark:text-[#7ad9b5]">Incoming</th>
              <th colSpan={2} className="bg-[#eda100]/10 px-2 py-1 text-center text-[#7a5200] dark:text-[#f2c45f]">Total</th>
              <th colSpan={3} className="bg-[#7c5cd6]/10 px-2 py-1 text-center text-[#4a3aa7] dark:text-[#b7a8f0]">Connected by call length</th>
            </tr>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted dark:border-line-dark">
              <th scope="col" className="w-10 px-2 py-1.5 text-right font-medium">#</th>
              <th scope="col" className="px-2 py-1.5 font-medium">Emp Id</th>
              {th('name', 'Name', false)}
              {COLS.map((c) => th(c.key, c.label))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line bg-accent-soft/40 font-semibold dark:border-line-dark dark:bg-accent-soft-dark/30">
              <td className="px-2 py-1.5" />
              <td className="px-2 py-1.5" />
              <td className="whitespace-nowrap px-2 py-1.5 text-ink dark:text-ink-dark">Team total</td>
              {COLS.map((c) => <td key={c.key} className="tabular whitespace-nowrap px-2 py-1.5 text-right text-ink dark:text-ink-dark">{show(built.total[c.key], c.kind)}</td>)}
            </tr>
            {sorted.map((r, i) => (
              <tr key={r.id} className="border-b border-line last:border-0 hover:bg-plane/60 dark:border-line-dark dark:hover:bg-[#1e1e25]">
                <td className="tabular px-2 py-1.5 text-right text-ink-muted">{i + 1}</td>
                <td className="tabular whitespace-nowrap px-2 py-1.5 text-ink-secondary dark:text-ink-dark-secondary">{r.id}</td>
                <td className="whitespace-nowrap px-2 py-1.5">
                  {a.dataset.employeeById.has(r.id)
                    ? <button type="button" onClick={() => navigate('employee', r.id)} className="font-medium text-ink hover:text-accent hover:underline dark:text-ink-dark">{r.name}</button>
                    : <span className="font-medium text-ink dark:text-ink-dark">{r.name}</span>}
                </td>
                {COLS.map((c) => <td key={c.key} className={`tabular whitespace-nowrap px-2 py-1.5 text-right ${r.days ? 'text-ink dark:text-ink-dark' : 'text-ink-muted'}`}>{show(r[c.key], c.kind)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p data-no-capture className="border-t border-line px-4 py-2 text-[11px] text-ink-muted dark:border-line-dark">
        Laid out like the team table of the Input DB sheet (columns A to L). Dialed, Incoming and the connected columns count each phone number once per executive per day; Incoming includes missed and rejected calls. The call-length columns split Total Connected, each connected number placed by its longest call that day. Only executives marked present, late or half day in icku attendance are listed, even when they made no calls.
        {built.leftOut > 0 ? ` ${formatNumber(built.leftOut)} executive(s) who made calls but are not marked present are left out.` : ''}
        {built.fallbackDays > 0 && unique?.first ? ` ${formatNumber(built.fallbackDays)} day(s) before ${formatDate(unique.first)} have no unique-number counts, so every call is counted on those days.` : ''}
        {!built.hasAttendance && att?.firstDay ? ` Attendance starts ${formatDate(att.firstDay)}.` : ''}
      </p>
    </Card>
    </div>
  );
}
