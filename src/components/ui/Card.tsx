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
    <section className={`rounded-[20px] border border-transparent bg-surface shadow-card dark:border-line-dark dark:bg-surface-dark ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 rounded-t-[20px] border-b border-line/70 px-4 py-3.5 dark:border-line-dark sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink dark:text-ink-dark"><span aria-hidden className="h-3.5 w-1 shrink-0 rounded-full bg-accent dark:bg-accent-dark" /><span className="min-w-0">{title}</span></h2>}
            {subtitle && <p className="mt-0.5 pl-3 text-xs text-ink-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={`px-4 py-4 sm:px-5 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
