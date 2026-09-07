import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { formatNumber } from '../lib/format';
import type { AttentionItem } from '../lib/insights';
import { useFilters } from '../state/FilterContext';
import { useRouter } from '../state/router';
import { Card } from './ui/Card';
import { Badge, Button } from './ui/Controls';
import { EmptyState } from './ui/States';

export function NeedsAttention({ items, limit = 8 }: { items: AttentionItem[]; limit?: number }) {
  const { attention, setAttention } = useFilters();
  const { navigate } = useRouter();
  const [showConfig, setShowConfig] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, limit);

  return (
    <Card
      title="Needs Attention"
      subtitle="Activity substantially below the selected team's average · no-activity flags apply to executives who were active in the previous period"
      actions={<Button size="sm" variant="ghost" onClick={() => setShowConfig((s) => !s)} aria-expanded={showConfig}><SlidersHorizontal className="h-3.5 w-3.5" /> Thresholds</Button>}
    >
      {showConfig && (
        <div className="mb-4 grid gap-3 rounded-lg border border-line bg-plane/60 p-3 text-xs dark:border-line-dark dark:bg-plane-dark/60 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-ink-muted">Below team average when calls/day &lt;</span>
            <span className="flex items-center gap-2">
              <input type="range" min={0.3} max={1} step={0.05} value={attention.belowAverageRatio} onChange={(e) => setAttention({ ...attention, belowAverageRatio: Number(e.target.value) })} className="w-full accent-accent" />
              <span className="tabular w-10 text-right font-medium text-ink dark:text-ink-dark">{Math.round(attention.belowAverageRatio * 100)}%</span>
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-ink-muted">Decline vs previous period ≥</span>
            <span className="flex items-center gap-2">
              <input type="range" min={0.1} max={0.8} step={0.05} value={attention.declineRatio} onChange={(e) => setAttention({ ...attention, declineRatio: Number(e.target.value) })} className="w-full accent-accent" />
              <span className="tabular w-10 text-right font-medium text-ink dark:text-ink-dark">{Math.round(attention.declineRatio * 100)}%</span>
            </span>
          </label>
          <label className="flex items-center gap-2 self-end">
            <input type="checkbox" checked={attention.flagNoActivity} onChange={(e) => setAttention({ ...attention, flagNoActivity: e.target.checked })} className="accent-accent" />
            <span className="text-ink-secondary dark:text-ink-dark-secondary">Flag executives with no activity recorded</span>
          </label>
        </div>
      )}
      {items.length === 0 ? (
        <EmptyState title="Nothing to flag" message="Every executive in scope is within the configured thresholds for this period." />
      ) : (
        <ul className={`grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3 ${showAll ? 'max-h-[30rem] overflow-y-auto scroll-thin pr-1' : ''}`}>
          {visible.map(({ stat, reasons }) => (
            <li key={stat.employee.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-line py-2.5 dark:border-line-dark">
              <div className="min-w-0">
                <button type="button" onClick={() => navigate('employee', stat.employee.id)} className="text-sm font-medium text-ink hover:text-accent hover:underline dark:text-ink-dark">{stat.employee.name}</button>
                <div className="text-[11px] text-ink-muted">{[stat.employee.id.startsWith('NAME:') || stat.employee.id === stat.employee.name ? '' : stat.employee.id, stat.employee.manager].filter(Boolean).join(' · ')}</div>
                <ul className="mt-1 space-y-0.5 text-xs text-ink-secondary dark:text-ink-dark-secondary">
                  {reasons.map((r) => <li key={r.label}>{r.detail}</li>)}
                </ul>
              </div>
              <div className="flex flex-wrap gap-1">
                {reasons.map((r) => <Badge key={r.label} tone={r.label === 'No Activity Recorded' ? 'critical' : 'warning'}>{r.label}</Badge>)}
              </div>
            </li>
          ))}
        </ul>
      )}
      {items.length > limit && (
        <div className="mt-2 text-center">
          <Button size="sm" variant="ghost" onClick={() => setShowAll((s) => !s)}>{showAll ? 'Show fewer' : `Show all ${formatNumber(items.length)}`}</Button>
        </div>
      )}
    </Card>
  );
}
