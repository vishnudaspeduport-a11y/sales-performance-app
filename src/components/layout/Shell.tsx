import { ChevronDown, ClipboardList, Database, GitCompare, LayoutDashboard, Lock, Menu, Moon, Network, PhoneCall, RefreshCw, Sun, TrendingUp, UserSearch, Users, X } from 'lucide-react';
import { EDUPORT_FAVICON, EduportLogo } from './Logo';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { formatTimestampIST } from '../../lib/dates';
import { useData } from '../../state/DataContext';
import { useTheme } from '../../state/ThemeContext';
import { useRouter, type PageKey } from '../../state/router';
import { useView } from '../../state/ViewContext';
import { Button, Segmented } from '../ui/Controls';

type NavItem = { key: PageKey; label: string; icon: typeof LayoutDashboard };

/** Call-analytics pages live under the Callyzer group; Pending Tasks stands on its own. */
const CALLYZER_PAGES: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'team', label: 'Team Performance', icon: Users },
  { key: 'employee', label: 'Employee Analysis', icon: UserSearch },
  { key: 'compare', label: 'Comparison', icon: GitCompare },
  { key: 'trends', label: 'Trends', icon: TrendingUp },
  { key: 'raw', label: 'Raw Data', icon: Database },
  { key: 'mapping', label: 'Team Mapping', icon: Network },
];
const PENDING: NavItem = { key: 'pending', label: 'Pending Tasks', icon: ClipboardList };
const isCallyzer = (page: PageKey) => CALLYZER_PAGES.some((i) => i.key === page);

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

/** Group name shown before the page title in the header. */
export function pageSection(page: PageKey): string | null {
  return isCallyzer(page) ? 'Callyzer' : null;
}

const ITEM = 'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors';
const ACTIVE = 'bg-accent-soft font-medium text-[#184f95] dark:bg-accent-soft-dark dark:text-[#cde2fb]';
const IDLE = 'text-ink-secondary hover:bg-plane dark:text-ink-dark-secondary dark:hover:bg-[#232322]';

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { route, navigate } = useRouter();
  const { pages: viewPages } = useView();
  const onCallyzer = isCallyzer(route.page);
  // The group opens while one of its pages is showing and folds away on Pending Tasks.
  const [open, setOpen] = useState(onCallyzer);
  useEffect(() => { setOpen(onCallyzer); }, [onCallyzer]);
  const go = (key: PageKey) => { navigate(key); onNavigate?.(); };
  const PendingIcon = PENDING.icon;
  const pendingActive = route.page === PENDING.key;
  if (viewPages) {
    // Manager view: a flat list of the pages it offers.
    const items = [...CALLYZER_PAGES, PENDING].filter((i) => viewPages.includes(i.key));
    return (
      <nav aria-label="Main" className="flex flex-col gap-0.5 px-2">
        {items.map((item) => { const Icon = item.icon; const active = route.page === item.key; return (
          <button key={item.key} type="button" onClick={() => go(item.key)} aria-current={active ? 'page' : undefined} className={`${ITEM} ${active ? ACTIVE : IDLE}`}>
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{item.label}</span>
          </button>
        ); })}
      </nav>
    );
  }
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-2">
      <button
        type="button"
        onClick={() => { if (onCallyzer) setOpen((v) => !v); else { setOpen(true); go('dashboard'); } }}
        aria-expanded={open}
        className={`${ITEM} ${onCallyzer ? 'font-medium text-ink dark:text-ink-dark' : IDLE}`}
      >
        <PhoneCall className={`h-4 w-4 shrink-0 ${onCallyzer ? 'text-accent dark:text-accent-dark' : ''}`} />
        <span className="truncate">Callyzer</span>
        <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-ink-muted transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden />
      </button>
      {open && (
        <div className="ml-4 flex flex-col gap-0.5 border-l border-line pl-2 dark:border-line-dark">
          {CALLYZER_PAGES.map((item) => {
            const active = route.page === item.key;
            const Icon = item.icon;
            return (
              <button key={item.key} type="button" onClick={() => go(item.key)} aria-current={active ? 'page' : undefined} className={`${ITEM} h-8 ${active ? ACTIVE : IDLE}`}>
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
      <button type="button" onClick={() => go(PENDING.key)} aria-current={pendingActive ? 'page' : undefined} className={`${ITEM} ${pendingActive ? ACTIVE : IDLE}`}>
        <PendingIcon className="h-4 w-4 shrink-0" />
        <span className="truncate">{PENDING.label}</span>
      </button>
    </nav>
  );
}

/** Small modal asking for the admin password. */
function AdminPasswordDialog({ onClose, onSubmit, configured }: { onClose: () => void; onSubmit: (password: string) => Promise<void>; configured: boolean }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) { setError('Enter the admin password.'); return; }
    setBusy(true); setError(null);
    try { await onSubmit(password); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not sign in.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="admin-dialog-title">
      <div className="absolute inset-0" onClick={onClose} />
      <form onSubmit={submit} className="relative w-full max-w-sm rounded-xl border border-line bg-surface p-5 shadow-xl dark:border-line-dark dark:bg-surface-dark">
        <h2 id="admin-dialog-title" className="text-sm font-semibold text-ink dark:text-ink-dark">Admin view</h2>
        <p className="mt-1 text-xs text-ink-muted">{configured ? 'Enter the admin password to see every page. This browser stays unlocked for 30 days.' : 'No admin password is set on the server yet, so the Admin view is open to everyone.'}</p>
        <input ref={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Admin password" aria-label="Admin password" autoComplete="current-password" className="mt-3 h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark" />
        {error && <p className="mt-2 text-xs text-[#8f1f1f] dark:text-[#f08c8c]" role="alert">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Unlock'}</Button>
        </div>
      </form>
    </div>
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
  const { view, admin, configured, setView, unlock, lock } = useView();
  const snapshot = !!dataset?.meta.snapshot;
  const [askPassword, setAskPassword] = useState(false);
  const onViewChange = (v: 'admin' | 'manager') => { if (v === 'admin' && admin !== true) setAskPassword(true); else void (v === 'manager' && admin === true && configured ? setView('manager') : setView(v)); };

  useEffect(() => { setOpen(false); }, [route.page]);
  useEffect(() => {
    document.title = `${PAGE_TITLES[route.page]} · ${pageSection(route.page) ?? 'Eduport Sales'} · Eduport Sales Performance`;
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
          {(() => { const Icon = [...CALLYZER_PAGES, PENDING].find((n) => n.key === route.page)?.icon; return Icon ? <span aria-hidden className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-[#184f95] dark:bg-accent-soft-dark dark:text-[#cde2fb] sm:flex"><Icon className="h-4 w-4" /></span> : null; })()}
          <h1 className="truncate text-base font-semibold text-ink dark:text-ink-dark">{view === 'admin' && pageSection(route.page) && <span className="font-normal text-ink-muted">{pageSection(route.page)} / </span>}{PAGE_TITLES[route.page]}</h1>
          <div className="ml-auto flex items-center gap-2">
            <Segmented ariaLabel="View" value={view} onChange={onViewChange} options={[{ value: 'admin', label: 'Admin' }, { value: 'manager', label: 'Manager' }]} />
            {admin === true && configured && <Button size="sm" variant="ghost" onClick={() => void lock()} title="Lock the Admin view in this browser"><Lock className="h-3.5 w-3.5" /><span className="hidden sm:inline">Lock</span></Button>}
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
        {askPassword && <AdminPasswordDialog onClose={() => setAskPassword(false)} onSubmit={unlock} configured={configured} />}
        {notice && (
          <div role="status" className="mx-4 mt-3 rounded-lg border border-line bg-surface px-4 py-2 text-xs text-ink-secondary shadow-card dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark-secondary sm:mx-6">{notice}</div>
        )}
        <main className="flex-1 px-4 py-5 sm:px-6">{children}</main>
        <footer className="px-4 py-3 text-center text-[11px] text-ink-muted sm:px-6 md:hidden">{snapshot ? 'Data snapshot' : 'Last updated'}: {formatTimestampIST(lastUpdated ?? undefined)} IST</footer>
      </div>
    </div>
  );
}
