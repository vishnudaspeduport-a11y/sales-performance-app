import type { ReactNode } from 'react';

export function Card({ title, subtitle, actions, children, className = '', bodyClassName = '' }: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`rounded-xl border border-line bg-surface shadow-card dark:border-line-dark dark:bg-surface-dark ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 dark:border-line-dark sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-ink dark:text-ink-dark">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={`px-4 py-4 sm:px-5 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
