import { useMemo, useState } from 'react';
import { EmployeeProfile } from '../components/EmployeeProfile';
import { Card } from '../components/ui/Card';
import { Badge, SearchInput, StatusDot } from '../components/ui/Controls';
import { EmptyState } from '../components/ui/States';
import { scoreBand } from '../config/metrics';
import { formatDuration, formatMetric, formatNumber, initials } from '../lib/format';
import { useRouter } from '../state/router';
import type { Analytics } from '../state/useAnalytics';

export function EmployeeAnalysisPage({ a, employeeId }: { a: Analytics; employeeId?: string }) {
  const { navigate } = useRouter();
  const [query, setQuery] = useState('');

  const stat = employeeId ? a.stats.find((s) => s.employee.id === employeeId) : undefined;
  const outOfScope = employeeId && !stat ? a.dataset.employeeById.get(employeeId) : undefined;

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return a.ranked.filter((s) => !q || s.employee.name.toLowerCase().includes(q) || s.employee.id.toLowerCase().includes(q) || s.employee.manager.toLowerCase().includes(q));
  }, [a.ranked, query]);

  if (stat) return <EmployeeProfile analytics={a} stat={stat} />;

  return (
    <div className="space-y-4">
      {outOfScope && (
        <div className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-secondary dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark-secondary">
          {outOfScope.name} is excluded by the current Sales Executive / team filters. Reset the filters to view this profile.
        </div>
      )}
      <Card title="Choose a Sales Executive" subtitle={`${formatNumber(a.employees.length)} executives in scope · ranked by total calls in the selected period`} actions={<SearchInput value={query} onChange={setQuery} placeholder="Search executive…" className="w-full sm:w-64" />}>
        {list.length === 0 ? (
          <EmptyState title="No executives match" />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((s) => {
              const band = scoreBand(s.score);
              return (
                <li key={s.employee.id}>
                  <button type="button" onClick={() => navigate('employee', s.employee.id)} className="flex w-full items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-left transition-colors hover:border-accent hover:bg-plane/60 dark:border-line-dark dark:hover:bg-[#1e1e25]">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-plane text-xs font-semibold text-ink-secondary dark:bg-[#22222a] dark:text-ink-dark-secondary">{initials(s.employee.name)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-ink dark:text-ink-dark"><StatusDot tone={s.totals.activeDays ? (band?.tone ?? 'neutral') : 'critical'} /><span className="truncate">{s.employee.name}</span></span>
                      <span className="block truncate text-[11px] text-ink-muted">
                        {s.totals.activeDays ? [a.has('totalCalls') && `${formatNumber(s.metrics.totalCalls)} calls`, a.has('connectionRate') && formatMetric(s.metrics.connectionRate, 'percent'), a.has('talkTime') && formatDuration(s.metrics.talkTime)].filter(Boolean).join(' · ') : 'No activity recorded'}
                      </span>
                    </span>
                    {s.totals.activeDays > 0 && <span className="tabular text-xs text-ink-muted">#{s.rank}</span>}
                    {band && <Badge tone={band.tone}>{s.score}</Badge>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
