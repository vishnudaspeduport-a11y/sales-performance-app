import { ArrowDown, ArrowUp, ArrowUpDown, Download } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toCsv, downloadText } from '../lib/csv';
import { formatDate } from '../lib/dates';
import { formatDuration, formatNumber } from '../lib/format';
import type { DailyRecord, Dataset, FieldDef } from '../types';
import { Card } from './ui/Card';
import { Button, SearchInput, Select } from './ui/Controls';
import { EmptyState } from './ui/States';

interface Column {
  key: string;
  label: string;
  kind: FieldDef['kind'];
  get: (r: DailyRecord, ds: Dataset) => string | number;
  display: (v: string | number) => string;
}

const PAGE_SIZES = ['25', '50', '100', '250'] as const;

export function DataTable({ dataset, records, range }: { dataset: Dataset; records: DailyRecord[]; range: { from: string; to: string } }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>('50');
  const [page, setPage] = useState(1);
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [downloadNote, setDownloadNote] = useState<string | null>(null);

  const columns = useMemo<Column[]>(() => {
    const cols: Column[] = [];
    for (const f of dataset.fields) {
      if (f.key === 'date') cols.push({ key: 'date', label: 'Date', kind: 'date', get: (r) => r.date, display: (v) => formatDate(String(v)) });
      else if (f.key === 'empId') {
        cols.push({ key: 'empId', label: 'Emp Id', kind: 'text', get: (r) => (r.empId.startsWith('NAME:') ? '' : r.empId), display: (v) => String(v) });
        cols.push({ key: 'name', label: 'Name', kind: 'text', get: (r, ds) => ds.employeeById.get(r.empId)?.name ?? r.empId, display: (v) => String(v) });
        if (dataset.dims.some((d) => d.key === 'manager')) cols.push({ key: 'manager', label: 'Manager', kind: 'text', get: (r, ds) => ds.employeeById.get(r.empId)?.manager ?? '', display: (v) => String(v) });
        if (dataset.dims.some((d) => d.key === 'tags')) cols.push({ key: 'tags', label: 'Tags', kind: 'text', get: (r, ds) => (ds.employeeById.get(r.empId)?.tags ?? []).join('; '), display: (v) => String(v) });
      } else if (f.kind === 'seconds') cols.push({ key: f.key, label: f.label, kind: 'seconds', get: (r) => { const v = (r as unknown as Record<string, number | null>)[f.key]; return v == null ? '' : v; }, display: (v) => (v === '' ? '–' : formatDuration(Number(v))) });
      else if (f.kind === 'count') cols.push({ key: f.key, label: f.label, kind: 'count', get: (r) => { const v = (r as unknown as Record<string, number | null>)[f.key]; return v == null ? '' : v; }, display: (v) => (v === '' ? '–' : formatNumber(Number(v))) });
      else cols.push({ key: f.key, label: f.label, kind: 'text', get: (r) => r.dims[f.key] ?? '', display: (v) => String(v) });
    }
    return cols;
  }, [dataset]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = records;
    if (q) list = list.filter((r) => columns.some((c) => String(c.get(r, dataset)).toLowerCase().includes(q)));
    for (const [k, v] of Object.entries(colFilters)) {
      const f = v.trim().toLowerCase();
      if (!f) continue;
      const col = columns.find((c) => c.key === k);
      if (!col) continue;
      if (col.kind === 'count' || col.kind === 'seconds') {
        // "> 50", ">= 50", "< 50", "= 50" or plain "50"; minutes for time columns.
        const m = /^(>=|<=|>|<|=)?\s*(\d+(?:\.\d+)?)$/.exec(f.replace(/,/g, ''));
        if (!m) continue; // still typing the operator: leave the rows as they are
        const n = Number(m[2]) * (col.kind === 'seconds' ? 60 : 1);
        list = list.filter((r) => {
          const val = col.get(r, dataset);
          if (val === '' || val == null) return false;
          const num = Number(val);
          switch (m[1]) { case '>': return num > n; case '<': return num < n; case '>=': return num >= n; case '<=': return num <= n; default: return num === n; }
        });
        continue;
      }
      list = list.filter((r) => {
        const val = col.get(r, dataset);
        return String(val).toLowerCase().includes(f) || col.display(val).toLowerCase().includes(f);
      });
    }
    const col = columns.find((c) => c.key === sort.key) ?? columns[0];
    list = [...list].sort((a, b) => {
      const va = col.get(a, dataset); const vb = col.get(b, dataset);
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [records, query, colFilters, sort, columns, dataset]);

  const size = Number(pageSize);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  useEffect(() => { setPage(1); }, [query, colFilters, pageSize, records]);
  const current = Math.min(page, pages);
  const slice = rows.slice((current - 1) * size, current * size);
  const visibleCols = columns.filter((c) => !hidden.has(c.key));

  const download = async () => {
    const headers = visibleCols.map((c) => c.label + (c.kind === 'seconds' ? ' (seconds)' : ''));
    const body = rows.map((r) => visibleCols.map((c) => c.get(r, dataset)));
    setDownloadNote('Preparing CSV…');
    const result = await downloadText(`sales-activity_${range.from}_to_${range.to}.csv`, toCsv(headers, body));
    setDownloadNote(result === 'saved' ? `Downloaded ${formatNumber(rows.length)} rows.` : result === 'declined' ? 'Download cancelled.' : 'Download is not available in this window. Open the dashboard in a new tab and try again.');
    setTimeout(() => setDownloadNote(null), 6000);
  };

  return (
    <Card
      title="Raw Data"
      subtitle={`${formatNumber(rows.length)} of ${formatNumber(records.length)} rows in the selected period · read-only view of the sheet data (${dataset.meta.sourceSheets.join(', ')})`}
      actions={
        <>
          <SearchInput value={query} onChange={setQuery} placeholder="Search rows…" className="w-full sm:w-52" />
          <Button size="sm" onClick={() => void download()} disabled={!rows.length}><Download className="h-3.5 w-3.5" /> Download CSV</Button>
        </>
      }
      bodyClassName="!px-0 !py-0"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-xs dark:border-line-dark">
        <span className="text-ink-muted">Columns:</span>
        {columns.map((c) => (
          <label key={c.key} className="inline-flex items-center gap-1 text-ink-secondary dark:text-ink-dark-secondary">
            <input type="checkbox" className="accent-accent" checked={!hidden.has(c.key)} onChange={(e) => setHidden((h) => { const n = new Set(h); if (e.target.checked) n.delete(c.key); else n.add(c.key); return n; })} />
            {c.label}
          </label>
        ))}
        {downloadNote && <span className="ml-auto text-ink-muted">{downloadNote}</span>}
      </div>
      {records.length === 0 ? (
        <EmptyState title="No rows in this period" message="Adjust the date range or the filters at the top." />
      ) : (
        <div className="overflow-x-auto scroll-thin">
          <table className="zebra w-full min-w-[800px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted dark:border-line-dark">
                {visibleCols.map((c) => (
                  <th key={c.key} className={`px-3 py-2 font-medium ${c.kind === 'count' || c.kind === 'seconds' ? 'text-right' : ''}`}>
                    <button type="button" onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key && s.dir === 'desc' ? 'asc' : 'desc' }))} className="inline-flex items-center gap-1 hover:text-ink dark:hover:text-ink-dark">
                      {c.label}
                      {sort.key === c.key ? (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                    </button>
                  </th>
                ))}
              </tr>
              <tr className="border-b border-line dark:border-line-dark">
                {visibleCols.map((c) => (
                  <th key={c.key} className="px-2 py-1">
                    <input aria-label={`Filter ${c.label}`} value={colFilters[c.key] ?? ''} onChange={(e) => setColFilters((f) => ({ ...f, [c.key]: e.target.value }))} placeholder={c.kind === 'count' ? '> 50' : c.kind === 'seconds' ? '> 30 (min)' : 'Filter…'} className="h-7 w-full min-w-[80px] rounded border border-line bg-surface px-2 text-xs font-normal text-ink placeholder:text-ink-muted dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={visibleCols.length} className="px-3 py-8 text-center text-xs text-ink-muted">No rows match the search or column filters.{Object.values(colFilters).some((v) => v.trim()) && <> <button type="button" onClick={() => setColFilters({})} className="font-medium text-accent hover:underline dark:text-accent-dark">Clear column filters</button></>}</td></tr>
              )}
              {slice.map((r) => (
                <tr key={`${r.date}|${r.empId}`} className="border-b border-line last:border-0 hover:bg-plane/60 dark:border-line-dark dark:hover:bg-[#1b2029]">
                  {visibleCols.map((c) => <td key={c.key} className={`px-3 py-1.5 ${c.kind === 'count' || c.kind === 'seconds' ? 'tabular text-right' : ''} text-ink-secondary dark:text-ink-dark-secondary`}>{c.display(c.get(r, dataset))}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-xs text-ink-muted dark:border-line-dark">
        <div className="flex items-center gap-2">
          <span>Rows per page</span>
          <Select ariaLabel="Rows per page" value={pageSize} onChange={setPageSize} options={PAGE_SIZES.map((p) => ({ value: p, label: p }))} className="w-20" />
        </div>
        <div className="flex items-center gap-2">
          <span>Page {current} of {pages}</span>
          <Button size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={current <= 1}>Previous</Button>
          <Button size="sm" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={current >= pages}>Next</Button>
        </div>
      </div>
    </Card>
  );
}
