import { Download, KeyRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatDate, formatTimestampIST } from '../lib/dates';
import { formatNumber } from '../lib/format';
import { Card } from './ui/Card';
import { Button } from './ui/Controls';
import { EmptyState, LoadingState } from './ui/States';

interface ArchiveInfo {
  date: string;
  rows: number;
  bytes: number;
  csvBytes: number;
  columns: string[];
  updatedAt: string;
}

const KEY_STORAGE = 'sales-dashboard-download-key';

function formatBytes(n: number): string {
  if (!n) return '–';
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** Daily exports of the sheet's call-level "Raw data" tab, kept after the tab is overwritten. */
export function CallLogArchive() {
  const [items, setItems] = useState<ArchiveInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(() => { try { return localStorage.getItem(KEY_STORAGE) ?? ''; } catch { return ''; } });
  const [showAll, setShowAll] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/archives', { cache: 'no-store' })
      .then(async (r) => { if (!r.ok) throw new Error(`status ${r.status}`); return (await r.json()) as { archives: ArchiveInfo[] }; })
      .then((d) => { if (!cancelled) setItems(d.archives ?? []); })
      .catch(() => { if (!cancelled) setError('The archive list could not be loaded.'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { try { localStorage.setItem(KEY_STORAGE, key); } catch { /* ignore */ } }, [key]);

  const visible = useMemo(() => (items ? (showAll ? items : items.slice(0, 14)) : []), [items, showAll]);

  const download = async (a: ArchiveInfo) => {
    if (!key.trim()) { setNote('Enter the download key first.'); return; }
    setNote(null);
    // Probe with the key so a wrong key shows a message instead of a blank tab.
    try {
      const res = await fetch(`/api/archives/${a.date}.csv`, { method: 'GET', headers: { 'x-download-key': key.trim() }, cache: 'no-store' });
      if (res.status === 401) { setNote('That download key is not valid.'); return; }
      if (!res.ok) { setNote(`Download failed (status ${res.status}).`); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `call-log-${a.date}.csv`; link.rel = 'noopener';
      document.body.appendChild(link); link.click();
      setTimeout(() => { document.body.removeChild(link); URL.revokeObjectURL(url); }, 1000);
    } catch {
      setNote('Download failed. Check your connection and try again.');
    }
  };

  return (
    <Card
      title="Call Log Archive"
      subtitle="Each day's Raw data tab, saved as it appeared in the sheet before it was overwritten · call-level rows, all columns"
      actions={
        <label className="flex items-center gap-2 text-xs text-ink-secondary dark:text-ink-dark-secondary">
          <KeyRound className="h-3.5 w-3.5 text-ink-muted" />
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Download key" aria-label="Download key" className="h-8 w-40 rounded-lg border border-line bg-surface px-2 text-sm text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark" />
        </label>
      }
      bodyClassName="!px-0 !py-0"
    >
      {note && <div role="status" className="border-b border-line px-4 py-2 text-xs text-[#8f1f1f] dark:border-line-dark dark:text-[#f08c8c]">{note}</div>}
      {error ? (
        <EmptyState title="Archive unavailable" message={error} />
      ) : items === null ? (
        <LoadingState label="Loading archive list…" />
      ) : items.length === 0 ? (
        <EmptyState title="No archived days yet" message="The first archive is created by the next sync after the archive storage is set up." />
      ) : (
        <>
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted dark:border-line-dark">
                  <th className="px-4 py-2 font-medium">Call date</th>
                  <th className="px-3 py-2 text-right font-medium">Calls</th>
                  <th className="px-3 py-2 text-right font-medium">CSV size</th>
                  <th className="px-3 py-2 font-medium">Last saved (IST)</th>
                  <th className="px-3 py-2 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => (
                  <tr key={a.date} className="border-b border-line last:border-0 dark:border-line-dark">
                    <td className="px-4 py-2 font-medium text-ink dark:text-ink-dark">{formatDate(a.date)}</td>
                    <td className="tabular px-3 py-2 text-right">{formatNumber(a.rows)}</td>
                    <td className="tabular px-3 py-2 text-right text-ink-secondary dark:text-ink-dark-secondary">{formatBytes(a.csvBytes)}</td>
                    <td className="px-3 py-2 text-ink-secondary dark:text-ink-dark-secondary">{formatTimestampIST(a.updatedAt)}</td>
                    <td className="px-3 py-2 text-right"><Button size="sm" onClick={() => void download(a)}><Download className="h-3.5 w-3.5" /> CSV</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-[11px] text-ink-muted dark:border-line-dark">
            <span>{formatNumber(items.length)} day(s) archived · columns: {items[0].columns.join(', ') || '–'}</span>
            {items.length > visible.length && <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>Show all</Button>}
          </div>
        </>
      )}
    </Card>
  );
}
