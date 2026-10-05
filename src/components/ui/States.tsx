import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './Controls';

export function LoadingState({ label = 'Loading data from Google Sheets…' }: { label?: string }) {
  return (
    <div role="status" className="flex flex-col items-center justify-center gap-3 py-16 text-ink-muted">
      <RefreshCw className="h-6 w-6 animate-spin text-accent" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-3 rounded-[20px] border border-transparent bg-surface px-6 py-14 text-center dark:border-line-dark dark:bg-surface-dark">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fbe4e4] text-status-critical dark:bg-[#3d1717]"><AlertTriangle className="h-5 w-5" /></span>
      <h3 className="text-base font-semibold text-ink dark:text-ink-dark">Unable to load data</h3>
      <p className="max-w-md text-sm text-ink-secondary dark:text-ink-dark-secondary">{message}</p>
      {onRetry && <Button variant="primary" onClick={onRetry}><RefreshCw className="h-4 w-4" /> Retry</Button>}
    </div>
  );
}

export function EmptyState({ title = 'No data available', message, action }: { title?: string; message?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-plane text-ink-muted dark:bg-[#22222a]"><Inbox className="h-5 w-5" /></span>
      <h3 className="text-sm font-semibold text-ink dark:text-ink-dark">{title}</h3>
      {message && <p className="max-w-md text-sm text-ink-muted">{message}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-lg bg-plane dark:bg-[#22222a] ${className}`} />;
}
