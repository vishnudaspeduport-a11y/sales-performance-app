import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

/* ---------------------------------------------------------------- */
/* Button                                                           */
/* ---------------------------------------------------------------- */
export function Button({ variant = 'secondary', size = 'md', className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md' }) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50';
  const sizes = size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3 text-sm';
  const variants = {
    primary: 'bg-ink text-white shadow-[0_10px_20px_-12px_rgba(17,17,20,0.7)] hover:bg-[#2a2a31] dark:bg-white dark:text-ink dark:hover:bg-[#e6e6ee]',
    secondary: 'border border-line bg-surface text-ink shadow-sm hover:bg-plane dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark dark:hover:bg-[#22222a]',
    ghost: 'text-ink-secondary hover:bg-plane dark:text-ink-dark-secondary dark:hover:bg-[#22222a]',
  }[variant];
  return <button type="button" className={`${base} ${sizes} ${variants} ${className}`} {...rest}>{children}</button>;
}

/* ---------------------------------------------------------------- */
/* Segmented control                                                */
/* ---------------------------------------------------------------- */
export function Segmented<T extends string>({ value, onChange, options, size = 'sm', ariaLabel }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; size?: 'sm' | 'md'; ariaLabel?: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex max-w-full overflow-x-auto rounded-xl bg-plane p-1 dark:bg-plane-dark">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`whitespace-nowrap rounded-lg px-2.5 font-medium transition-colors ${size === 'sm' ? 'h-7 text-xs' : 'h-8 text-sm'} ${value === o.value ? 'bg-surface text-ink shadow-card dark:bg-surface-dark dark:text-ink-dark' : 'text-ink-muted hover:text-ink dark:hover:text-ink-dark'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Native select                                                    */
/* ---------------------------------------------------------------- */
export function Select<T extends string>({ value, onChange, options, ariaLabel, className = '' }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; ariaLabel?: string; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-9 w-full appearance-none rounded-[20px] border border-transparent bg-surface pl-3 pr-8 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-ink-muted" />
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Searchable multi-select                                          */
/* ---------------------------------------------------------------- */
export interface MultiOption { value: string; label: string; hint?: string }

export function MultiSelect({ label, options, selected, onChange, placeholder = 'All', max, className = '' }: {
  label: string;
  options: MultiOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  /** maximum selectable (for compare) */
  max?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    setTimeout(() => inputRef.current?.focus(), 0);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q)) : options;
  }, [options, query]);

  const toggle = (v: string) => {
    if (selected.includes(v)) onChange(selected.filter((x) => x !== v));
    else if (!max || selected.length < max) onChange([...selected, v]);
  };
  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o.label])), [options]);
  const summary = selected.length === 0 ? placeholder : selected.length === 1 ? byValue.get(selected[0]) ?? selected[0] : `${selected.length} selected`;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-[20px] border border-transparent bg-surface px-3 text-left text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
      >
        <span className="truncate"><span className="text-ink-muted">{label}: </span>{summary}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-muted" />
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-full min-w-[16rem] overflow-hidden rounded-[20px] border border-transparent bg-surface shadow-lg dark:border-line-dark dark:bg-surface-dark">
          <div className="flex items-center gap-2 border-b border-line px-2 dark:border-line-dark">
            <Search className="h-4 w-4 text-ink-muted" />
            <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" className="h-9 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted dark:text-ink-dark" />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X className="h-4 w-4 text-ink-muted" /></button>}
          </div>
          <div className="flex items-center justify-between px-3 py-1.5 text-xs text-ink-muted">
            <span>{selected.length ? `${selected.length} selected${max ? ` of ${max}` : ''}` : placeholder}</span>
            {selected.length > 0 && <button type="button" className="font-medium text-accent hover:underline" onClick={() => onChange([])}>Clear</button>}
          </div>
          <ul role="listbox" aria-multiselectable className="max-h-64 overflow-y-auto scroll-thin py-1">
            {filtered.length === 0 && <li className="px-3 py-2 text-sm text-ink-muted">No matches</li>}
            {filtered.map((o) => {
              const on = selected.includes(o.value);
              const disabled = !on && !!max && selected.length >= max;
              return (
                <li key={o.value} role="option" aria-selected={on}>
                  <button type="button" disabled={disabled} onClick={() => toggle(o.value)} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-plane disabled:opacity-40 dark:hover:bg-[#22222a] ${on ? 'text-ink dark:text-ink-dark' : 'text-ink-secondary dark:text-ink-dark-secondary'}`}>
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-accent bg-accent text-white' : 'border-axis'}`}>{on && <Check className="h-3 w-3" />}</span>
                    <span className="truncate">{o.label}</span>
                    {o.hint && <span className="ml-auto shrink-0 text-xs text-ink-muted">{o.hint}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Search input                                                     */
/* ---------------------------------------------------------------- */
export function SearchInput({ value, onChange, placeholder = 'Search…', className = '' }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-muted" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-9 w-full rounded-[20px] border border-transparent bg-surface pl-8 pr-8 text-sm text-ink outline-none placeholder:text-ink-muted focus-visible:ring-2 focus-visible:ring-accent dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark" />
      {value && <button type="button" aria-label="Clear" onClick={() => onChange('')} className="absolute right-2 top-2.5 text-ink-muted"><X className="h-4 w-4" /></button>}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Badge                                                            */
/* ---------------------------------------------------------------- */
export function Badge({ tone = 'neutral', children, className = '' }: { tone?: 'neutral' | 'good' | 'warning' | 'critical' | 'accent'; children: ReactNode; className?: string }) {
  const tones = {
    neutral: 'bg-plane text-ink-secondary dark:bg-[#22222a] dark:text-ink-dark-secondary',
    good: 'bg-[#e6f5e6] text-[#006300] dark:bg-[#12331a] dark:text-[#5fd35f]',
    warning: 'bg-[#fff3d6] text-[#7a5200] dark:bg-[#3a2c0a] dark:text-[#fab219]',
    critical: 'bg-[#fbe4e4] text-[#8f1f1f] dark:bg-[#3d1717] dark:text-[#f08c8c]',
    accent: 'bg-accent-soft text-[#184f95] dark:bg-accent-soft-dark dark:text-[#cde2fb]',
  }[tone];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${tones} ${className}`}>{children}</span>;
}

/** Small filled dot used as a status indicator beside a label. */
export function StatusDot({ tone }: { tone: 'good' | 'warning' | 'critical' | 'neutral' }) {
  const color = { good: 'bg-status-good', warning: 'bg-status-warning', critical: 'bg-status-critical', neutral: 'bg-axis' }[tone];
  return <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`} />;
}
