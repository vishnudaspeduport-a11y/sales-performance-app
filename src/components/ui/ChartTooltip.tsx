import type { ReactNode } from 'react';

/** Shared tooltip chrome so every chart's hover layer looks identical. */
export function TooltipFrame({ title, rows, footer }: { title: ReactNode; rows: { label: string; value: string; color?: string }[]; footer?: ReactNode }) {
  return (
    <div className="min-w-[11rem] rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg dark:border-line-dark dark:bg-surface-dark">
      <div className="mb-1 font-semibold text-ink dark:text-ink-dark">{title}</div>
      <dl className="space-y-0.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4">
            <dt className="flex items-center gap-1.5 text-ink-muted">
              {r.color && <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: r.color }} />}
              {r.label}
            </dt>
            <dd className="tabular font-medium text-ink dark:text-ink-dark">{r.value}</dd>
          </div>
        ))}
      </dl>
      {footer && <div className="mt-1.5 border-t border-line pt-1.5 text-ink-muted dark:border-line-dark">{footer}</div>}
    </div>
  );
}
