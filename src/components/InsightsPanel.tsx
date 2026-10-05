import { ArrowDownRight, ArrowUpRight, Info } from 'lucide-react';
import type { Insight } from '../lib/insights';
import { Card } from './ui/Card';
import { EmptyState } from './ui/States';

export function InsightsPanel({ insights, title = 'Team Insights', subtitle = 'Generated from the calculated dashboard data for the selected period', fixedHeight = false }: {
  insights: Insight[];
  title?: string;
  subtitle?: string;
  /** fill the parent's height and scroll inside (used when paired with another card) */
  fixedHeight?: boolean;
}) {
  return (
    <Card title={title} subtitle={subtitle} className={fixedHeight ? 'flex h-full flex-col' : ''} bodyClassName={fixedHeight ? 'min-h-0 flex-1 overflow-y-auto scroll-thin' : ''}>
      {insights.length === 0 ? (
        <EmptyState title="No insights yet" message="Insights appear once there is activity in the selected period." />
      ) : (
        <ul className="space-y-2.5">
          {insights.map((ins, i) => {
            const Icon = ins.tone === 'positive' ? ArrowUpRight : ins.tone === 'negative' ? ArrowDownRight : Info;
            const tone = ins.tone === 'positive' ? 'bg-[#e6f5e6] text-[#006300] dark:bg-[#12331a] dark:text-[#5fd35f]' : ins.tone === 'negative' ? 'bg-[#fbe4e4] text-[#8f1f1f] dark:bg-[#3d1717] dark:text-[#f08c8c]' : 'bg-plane text-ink-secondary dark:bg-[#232322] dark:text-ink-dark-secondary';
            return (
              <li key={i} className="flex items-start gap-2.5 text-sm text-ink-secondary dark:text-ink-dark-secondary">
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${tone}`}><Icon className="h-3 w-3" aria-hidden /></span>
                <span>{ins.text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
