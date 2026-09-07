import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { METRICS, scoreBand, type MetricKey } from '../config/metrics';
import { formatDate } from '../lib/dates';
import { formatMetric, formatNumber } from '../lib/format';
import type { EmployeeStats, TeamStats } from '../lib/metrics';
import { useRouter } from '../state/router';
import { Card } from './ui/Card';
import { Badge, Button, SearchInput, StatusDot } from './ui/Controls';
import { EmptyState } from './ui/States';

type ColKey = 'rank' | 'name' | MetricKey | 'bestDay';

interface Col {
  key: ColKey;
  label: string;
  numeric: boolean;
  metric?: MetricKey;
}

const METRIC_COLS: MetricKey[] = ['totalCalls', 'connected', 'notConnected', 'connectionRate', 'talkTime', 'avgTalkTime', 'band02', 'band24', 'band4p', 'callsPerDay', 'activeDays'];

function bandTone(score: number | null): 'good' | 'warning' | 'critical' | 'neutral' {
  const b = scoreBand(score);
  return b ? b.tone : 'neutral';
}

export function EmployeeTable({ stats, team, has, recentIds, compact = false, onShowAll }: {
  stats: EmployeeStats[];
  team: TeamStats;
  has: (k: MetricKey) => boolean;
  /** employees active in the current or previous period; others are hidden unless searched for */
  recentIds?: Set<string>;
  compact?: boolean;
  onShowAll?: () => void;
}) {
  const { navigate } = useRouter();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: ColKey; dir: 'asc' | 'desc' }>({ key: 'totalCalls', dir: 'desc' });
  const [limit, setLimit] = useState(compact ? 10 : 25);

  const cols = useMemo<Col[]>(() => {
    const c: Col[] = [{ key: 'rank', label: 'Rank', numeric: true }, { key: 'name', label: 'Sales Executive', numeric: false }];
    for (const k of METRIC_COLS) if (has(k)) c.push({ key: k, label: METRICS[k].label, numeric: true, metric: k });
    if (has('totalCalls')) c.push({ key: 'bestDay', label: 'Best Day', numeric: false });
    if (has('score')) c.push({ key: 'score', label: 'Performance Score', numeric: true, metric: 'score' });
    return c;
  }, [has]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = stats.filter((s) => s.totals.activeDays > 0 || (!compact && (q || !recentIds || recentIds.has(s.employee.id))));
    if (q) list = list.filter((s) => s.employee.name.toLowerCase().includes(q) || s.employee.id.toLowerCase().includes(q) || s.employee.manager.toLowerCase().includes(q));
    const val = (s: EmployeeStats): number | string | null => {
      switch (sort.key) {
        case 'rank': return s.rank;
        case 'name': return s.employee.name;
        case 'bestDay': return s.bestDay?.date ?? '';
        case 'score': return s.score;
        default: return s.metrics[sort.key] ?? null;
      }
    };
    list = [...list].sort((a, b) => {
      const va = val(a); const vb = val(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === 'string' || typeof vb === 'string' ? String(va).localeCompare(String(vb)) : (va as number) - (vb as number);
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [stats, query, sort, compact, recentIds]);

  const toggleSort = (key: ColKey, numeric: boolean) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: numeric ? 'desc' : 'asc' }));
  };

  const avgCpd = team.avgCallsPerEmployeeDay ?? 0;
  const visible = rows.slice(0, limit);

  const cell = (s: EmployeeStats, c: Col) => {
    switch (c.key) {
      case 'rank': return <span className="tabular text-ink-muted">{s.totals.activeDays ? s.rank : '–'}</span>;
      case 'name':
        return (
          <button type="button" onClick={() => navigate('employee', s.employee.id)} className="group flex items-center gap-2 text-left">
            <StatusDot tone={has('score') ? bandTone(s.score) : s.totals.activeDays ? 'neutral' : 'critical'} />
            <span>
              <span className="font-medium text-ink group-hover:text-accent group-hover:underline dark:text-ink-dark">{s.employee.name}</span>
              {(s.employee.manager || s.employee.id !== s.employee.name) && <span className="block text-[11px] text-ink-muted">{[s.employee.id.startsWith('NAME:') ? '' : s.employee.id, s.employee.manager].filter(Boolean).join(' · ')}</span>}
            </span>
          </button>
        );
      case 'bestDay': return s.bestDay ? <span className="text-ink-secondary dark:text-ink-dark-secondary">{formatDate(s.bestDay.date)} <span className="text-ink-muted">({formatNumber(s.bestDay.metrics.totalCalls)})</span></span> : '–';
      case 'score': {
        const b = scoreBand(s.score);
        return s.score == null ? <span className="text-ink-muted">–</span> : <span className="inline-flex items-center gap-2"><span className="tabular font-medium">{s.score}</span>{b && <Badge tone={b.tone}>{b.label}</Badge>}</span>;
      }
      default: {
        const v = s.metrics[c.key as MetricKey];
        const def = METRICS[c.key as MetricKey];
        let tone = '';
        if (c.key === 'callsPerDay' && v != null && avgCpd > 0) tone = v >= avgCpd ? '' : v < avgCpd * 0.7 ? 'text-[#8f1f1f] dark:text-[#f08c8c]' : 'text-[#7a5200] dark:text-[#fab219]';
        if (c.key === 'connectionRate' && v != null && team.metrics.connectionRate != null) tone = v >= team.metrics.connectionRate ? 'text-[#006300] dark:text-[#5fd35f]' : '';
        return <span className={`tabular ${tone}`}>{formatMetric(v, def.format)}</span>;
      }
    }
  };

  return (
    <Card
      title="Sales Executive Performance"
      subtitle={compact ? `Top ${Math.min(limit, rows.length)} by ${METRICS[sort.key as MetricKey]?.label?.toLowerCase() ?? sort.key} · click a name for details` : `${formatNumber(rows.length)} executives active in this or the previous period · click any column to sort · search to find anyone else`}
      actions={<SearchInput value={query} onChange={setQuery} placeholder="Search executive…" className="w-full sm:w-56" />}
      bodyClassName="!px-0 !py-0"
    >
      {rows.length === 0 ? (
        <EmptyState title="No executives match" message={query ? 'Try a different search.' : 'No activity was recorded for the selected filters.'} />
      ) : (
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted dark:border-line-dark">
                {cols.map((c) => (
                  <th key={c.key} scope="col" className={`px-3 py-2 font-medium ${c.numeric ? 'text-right' : ''} ${c.key === 'name' ? 'sticky left-0 z-10 bg-surface dark:bg-surface-dark' : ''}`}>
                    <button type="button" onClick={() => toggleSort(c.key, c.numeric)} className={`inline-flex items-center gap-1 hover:text-ink dark:hover:text-ink-dark ${c.numeric ? 'flex-row-reverse' : ''}`} aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      {c.label}
                      {sort.key === c.key ? (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <tr key={s.employee.id} className="border-b border-line last:border-0 hover:bg-plane/60 dark:border-line-dark dark:hover:bg-[#202020]">
                  {cols.map((c) => (
                    <td key={c.key} className={`px-3 py-2 align-middle ${c.numeric ? 'text-right' : ''} ${c.key === 'name' ? 'sticky left-0 z-10 bg-surface dark:bg-surface-dark' : ''}`}>{cell(s, c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > visible.length && (
        <div className="flex items-center justify-center gap-2 border-t border-line px-4 py-2.5 dark:border-line-dark">
          {compact && onShowAll ? (
            <Button size="sm" variant="ghost" onClick={onShowAll}>View all {formatNumber(rows.length)} executives →</Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + 25)}>Show more ({formatNumber(rows.length - visible.length)} remaining)</Button>
          )}
        </div>
      )}
      {has('score') && !compact && (
        <p className="border-t border-line px-4 py-2 text-[11px] text-ink-muted dark:border-line-dark">Performance Score is a calculated dashboard metric (35% calls, 30% connected, 20% talk time, 15% connection rate, per active day, normalised against the selected team). It is not a source field.</p>
      )}
    </Card>
  );
}
