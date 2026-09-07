import { ArrowDown, ArrowUp, Eye, EyeOff, LayoutGrid, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '../ui/Controls';

/**
 * Per-page section arrangement that the viewer can customise in the browser:
 * move sections up/down, hide/show them, reset to the default. The choice is
 * stored in localStorage under a key per page, so it is personal to this
 * browser and never affects other viewers.
 */
export interface PageSection {
  key: string;
  title: string;
  render: () => ReactNode;
  /** section is not applicable for the current data (e.g. no call log) */
  unavailable?: boolean;
}

interface LayoutState {
  order: string[];
  hidden: string[];
}

function storageKey(page: string) { return `sales-dashboard-layout:${page}`; }

function loadLayout(page: string): LayoutState | null {
  try {
    const raw = localStorage.getItem(storageKey(page));
    if (!raw) return null;
    const v = JSON.parse(raw) as LayoutState;
    if (!Array.isArray(v.order) || !Array.isArray(v.hidden)) return null;
    return v;
  } catch { return null; }
}

function saveLayout(page: string, state: LayoutState | null) {
  try { if (state) localStorage.setItem(storageKey(page), JSON.stringify(state)); else localStorage.removeItem(storageKey(page)); } catch { /* ignore */ }
}

export function usePageLayout(page: string, sections: PageSection[]) {
  const defaults = useMemo(() => sections.map((s) => s.key), [sections]);
  const [state, setState] = useState<LayoutState | null>(() => loadLayout(page));
  const [editing, setEditing] = useState(false);

  // Effective order: saved order first (dropping unknown keys), then any new sections appended.
  const order = useMemo(() => {
    const saved = (state?.order ?? []).filter((k) => defaults.includes(k));
    return [...saved, ...defaults.filter((k) => !saved.includes(k))];
  }, [state, defaults]);
  const hidden = useMemo(() => new Set((state?.hidden ?? []).filter((k) => defaults.includes(k))), [state, defaults]);

  const update = useCallback((next: LayoutState) => { setState(next); saveLayout(page, next); }, [page]);
  const move = useCallback((key: string, dir: -1 | 1) => {
    const i = order.indexOf(key); const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = [...order]; [next[i], next[j]] = [next[j], next[i]];
    update({ order: next, hidden: [...hidden] });
  }, [order, hidden, update]);
  const toggleHidden = useCallback((key: string) => {
    const h = new Set(hidden); if (h.has(key)) h.delete(key); else h.add(key);
    update({ order, hidden: [...h] });
  }, [order, hidden, update]);
  const reset = useCallback(() => { setState(null); saveLayout(page, null); }, [page]);

  useEffect(() => { if (!editing) return; const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setEditing(false); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [editing]);

  return { order, hidden, editing, setEditing, move, toggleHidden, reset, customised: state != null };
}

/** Toolbar shown at the top of a customisable page. */
export function LayoutToolbar({ layout, sectionCount }: { layout: ReturnType<typeof usePageLayout>; sectionCount: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="text-xs text-ink-muted">
        {layout.editing ? 'Use the arrows to reorder sections and the eye to hide or show them. Saved in this browser only.' : layout.customised ? 'Custom layout (this browser)' : ''}
      </div>
      <div className="flex items-center gap-2">
        {layout.editing && layout.customised && <Button size="sm" variant="ghost" onClick={layout.reset}><RotateCcw className="h-3.5 w-3.5" /> Reset to default</Button>}
        <Button size="sm" variant={layout.editing ? 'primary' : 'secondary'} onClick={() => layout.setEditing(!layout.editing)} aria-pressed={layout.editing}>
          {layout.editing ? <><X className="h-3.5 w-3.5" /> Done</> : <><LayoutGrid className="h-3.5 w-3.5" /> Customize layout</>}
        </Button>
      </div>
      {layout.editing && layout.hidden.size > 0 && (
        <div className="w-full text-[11px] text-ink-muted">{layout.hidden.size} of {sectionCount} sections hidden.</div>
      )}
    </div>
  );
}

/** Renders the sections in the chosen order with edit controls when customising. */
export function PageSections({ layout, sections }: { layout: ReturnType<typeof usePageLayout>; sections: PageSection[] }) {
  const byKey = new Map(sections.map((s) => [s.key, s]));
  const visible = layout.order.map((k) => byKey.get(k)!).filter((s) => s && !s.unavailable);
  return (
    <>
      {visible.map((s, i) => {
        const isHidden = layout.hidden.has(s.key);
        if (isHidden && !layout.editing) return null;
        return (
          <div key={s.key} className={`relative ${layout.editing ? 'rounded-xl ring-1 ring-accent/40 ring-offset-2 ring-offset-plane dark:ring-offset-plane-dark' : ''}`}>
            {layout.editing && (
              <div className="mb-1 flex items-center justify-between gap-2 px-1">
                <span className="text-xs font-medium text-ink-secondary dark:text-ink-dark-secondary">{i + 1}. {s.title}{isHidden && <span className="ml-2 text-ink-muted">(hidden)</span>}</span>
                <span className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => layout.move(s.key, -1)} disabled={i === 0} aria-label={`Move ${s.title} up`}><ArrowUp className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => layout.move(s.key, 1)} disabled={i === visible.length - 1} aria-label={`Move ${s.title} down`}><ArrowDown className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => layout.toggleHidden(s.key)} aria-label={isHidden ? `Show ${s.title}` : `Hide ${s.title}`}>{isHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</Button>
                </span>
              </div>
            )}
            <div className={isHidden ? 'opacity-40' : ''}>{s.render()}</div>
          </div>
        );
      })}
    </>
  );
}
