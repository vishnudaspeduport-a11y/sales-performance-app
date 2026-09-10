import { ClipboardList, Database, GitCompare, LayoutDashboard, Menu, Moon, Network, RefreshCw, Sun, TrendingUp, UserSearch, Users, X } from 'lucide-react';
import { EDUPORT_FAVICON, EduportLogo } from './Logo';
import { useEffect, useState, type ReactNode } from 'react';
import { formatTimestampIST } from '../../lib/dates';
import { useData } from '../../state/DataContext';
import { useTheme } from '../../state/ThemeContext';
import { useRouter, type PageKey } from '../../state/router';
import { Button } from '../ui/Controls';

const NAV: { key: PageKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'team', label: 'Team Performance', icon: Users },
  { key: 'employee', label: 'Employee Analysis', icon: UserSearch },
  { key: 'compare', label: 'Comparison', icon: GitCompare },
  { key: 'trends', label: 'Trends', icon: TrendingUp },
  { key: 'raw', label: 'Raw Data', icon: Database },
  { key: 'pending', label: 'Pending Tasks', icon: ClipboardList },
  { key: 'mapping', label: 'Team Mapping', icon: Network },
];

export const PAGE_TITLES: Record<PageKey, string> = {
  dashboard: 'Dashboard',
  team: 'Team Performance',
  employee: 'Employee Analysis',
  compare: 'Comparison',
  trends: 'Trends',
  raw: 'Raw Data',
  pending: 'Pending Tasks',
  mapping: 'Team Mapping',
};

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { route, navigate } = useRouter();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-2">
      {NAV.map((item) => {
        const active = route.page === item.key;
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => { navigate(item.key); onNavigate?.(); }}
            aria-current={active ? 'page' : undefined}
            className={`flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors ${active ? 'bg-accent-soft font-medium text-[#184f95] dark:bg-accent-soft-dark dark:text-[#cde2fb]' : 'text-ink-secondary hover:bg-plane dark:text-ink-dark-secondary dark:hover:bg-[#232322]'}`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-4">
      <EduportLogo size={36} />
      <div className="leading-tight">
        <div className="text-sm font-semibold text-ink dark:text-ink-dark">Eduport <span className="font-normal text-ink-secondary dark:text-ink-dark-secondary">Sales</span></div>
        <div className="text-[11px] text-ink-muted">Performance dashboard</div>
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { route } = useRouter();
  const { theme, toggle } = useTheme();
  const { lastUpdated, refreshing, load, dataset, notice } = useData();
  const snapshot = !!dataset?.meta.snapshot;

  useEffect(() => { setOpen(false); }, [route.page]);
  useEffect(() => {
    document.title = `${PAGE_TITLES[route.page]} · Eduport Sales Performance`;
    let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!icon) { icon = document.createElement('link'); icon.rel = 'icon'; document.head.appendChild(icon); }
    icon.type = 'image/svg+xml';
    icon.href = EDUPORT_FAVICON;
  }, [route.page]);

  return (
    <div className="flex min-h-full">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface py-4 dark:border-line-dark dark:bg-surface-dark lg:flex">
        <Brand />
        <div className="mt-6"><NavList /></div>
        <div className="mt-auto px-4 text-[11px] leading-relaxed text-ink-muted">
          <div>Read-only view</div>
          <div>Source: Google Sheets {dataset?.meta.sourceSheets?.length ? `(${dataset.meta.sourceSheets.join(', ')})` : ''}</div>
          <div>Timezone: Asia/Kolkata</div>
        </div>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-surface py-4 shadow-xl dark:bg-surface-dark">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="rounded-lg p-2 text-ink-muted hover:bg-plane dark:hover:bg-[#232322]"><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-6"><NavList onNavigate={() => setOpen(false)} /></div>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur dark:border-line-dark dark:bg-surface-dark/95 sm:px-6">
          <button type="button" aria-label="Open menu" onClick={() => setOpen(true)} className="rounded-lg p-2 text-ink-secondary hover:bg-plane dark:text-ink-dark-secondary dark:hover:bg-[#232322] lg:hidden"><Menu className="h-5 w-5" /></button>
          <h1 className="truncate text-base font-semibold text-ink dark:text-ink-dark">{PAGE_TITLES[route.page]}</h1>
          <div className="ml-auto flex items-center gap-2">
            {snapshot ? (
              <span className="hidden text-xs text-ink-muted md:inline" title="This page carries an exported copy of the sheet data">Data snapshot: {formatTimestampIST(lastUpdated ?? undefined)} IST</span>
            ) : (
              <span className="hidden text-xs text-ink-muted md:inline" title="Time the data was last synced from the Google Sheet (IST)">Last updated: {formatTimestampIST(lastUpdated ?? undefined)}</span>
            )}
            {!snapshot && (
              <Button size="sm" onClick={() => void load(true)} disabled={refreshing} aria-label="Refresh data">
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">{refreshing ? 'Refreshing…' : 'Refresh Data'}</span>
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </header>
        {notice && (
          <div role="status" className="mx-4 mt-3 rounded-lg border border-line bg-surface px-4 py-2 text-xs text-ink-secondary shadow-card dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark-secondary sm:mx-6">{notice}</div>
        )}
        <main className="flex-1 px-4 py-5 sm:px-6">{children}</main>
        <footer className="px-4 py-3 text-center text-[11px] text-ink-muted sm:px-6 md:hidden">{snapshot ? 'Data snapshot' : 'Last updated'}: {formatTimestampIST(lastUpdated ?? undefined)} IST</footer>
      </div>
    </div>
  );
}
