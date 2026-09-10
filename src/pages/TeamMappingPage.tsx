import { useMemo, useState } from 'react';
import { KPIGrid, type KPI } from '../components/KPICard';
import { Card } from '../components/ui/Card';
import { Badge, Button, SearchInput, Select } from '../components/ui/Controls';
import { EmptyState } from '../components/ui/States';
import { addDays, formatDate, formatTimestampIST, todayIST } from '../lib/dates';
import { formatNumber } from '../lib/format';
import { teamLabel } from '../lib/pending';
import type { Dataset, DirectoryEntry } from '../types';

const UNASSIGNED = '__unassigned__';
const ALL = '__all__';
const RECENT_DAYS = 30;

type Focus = 'none' | 'mapped' | 'unassigned' | 'notInDir' | 'crm' | 'idle';
const FOCUS_LABEL: Record<Focus, string> = { none: '', mapped: 'Executives mapped from the HR directory', unassigned: 'Unassigned · no manager in the directory', notInDir: 'Not in the HR directory', crm: 'CRM team differs from the HR manager', idle: `No calls in ${RECENT_DAYS} days` };
const FOCUS_TEST: Record<Focus, (r: MappingRow) => boolean> = {
  none: () => true,
  mapped: (r) => !!r.manager && r.source === 'directory',
  unassigned: (r) => !r.manager,
  notInDir: (r) => r.source !== 'directory',
  crm: (r) => r.flags.some((f) => f.startsWith('CRM team differs')),
  idle: (r) => r.flags.some((f) => f.startsWith('No calls')),
};

interface MappingRow {
  empNo: string;
  name: string;
  title: string;
  location: string;
  manager: string;
  status: string;
  source: 'directory' | 'sheet' | 'none';
  crmTeam: string;
  lastCall: string | null;
  flags: string[];
}

function crmMatches(manager: string, crmRole: string): boolean | null {
  if (!crmRole || !manager) return null;
  const m = /team[\s_-]*(.+)$/i.exec(crmRole);
  if (!m) return null;
  const key = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const t = key(m[1]);
  return t === 'trainees' ? null : key(manager).includes(t);
}

function buildRows(dataset: Dataset): MappingRow[] {
  const since = addDays(todayIST(), -RECENT_DAYS);
  const lastCall = new Map<string, string>();
  for (const r of dataset.records) if (r.date >= since) { const cur = lastCall.get(r.empId); if (!cur || r.date > cur) lastCall.set(r.empId, r.date); }
  const crmByEmp = new Map<string, string>();
  const crmByName = new Map<string, string>();
  for (const u of dataset.pending?.users ?? []) { if (u.empNo) crmByEmp.set(u.empNo, u.role); crmByName.set(u.name.toLowerCase().replace(/[^a-z]/g, ''), u.role); }
  const dirByEmp = new Map<string, DirectoryEntry>(dataset.directory.map((d) => [d.empNo, d]));
  const rows = new Map<string, MappingRow>();
  const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const push = (empNo: string, name: string, title: string, location: string, manager: string, status: string, source: MappingRow['source']) => {
    const crm = crmByEmp.get(empNo) ?? crmByName.get(nameKey(name)) ?? '';
    const last = lastCall.get(empNo) ?? null;
    const flags: string[] = [];
    if (!manager) flags.push('No manager');
    if (source === 'none') flags.push('Not in HR directory');
    if (source === 'sheet') flags.push('Not in HR directory · manager from sheet');
    if (crm && crmMatches(manager, crm) === false) flags.push(`CRM team differs (${teamLabel(crm)})`);
    if (/exited|resigned/i.test(status) && last) flags.push('Exited but still has calls');
    if (!last && /working/i.test(status)) flags.push(`No calls in ${RECENT_DAYS} days`);
    rows.set(empNo, { empNo, name, title, location, manager, status, source, crmTeam: crm, lastCall: last, flags });
  };
  for (const d of dataset.directory) push(d.empNo, d.name, d.title, d.location, d.managerName, d.status, 'directory');
  for (const e of dataset.employees) {
    if (rows.has(e.id)) continue;
    const d = dirByEmp.get(e.id);
    push(e.id, e.name, e.title || d?.title || '', e.location || '', e.manager, e.status, e.mappingSource === 'directory' ? 'directory' : e.mappingSource === 'sheet' ? 'sheet' : 'none');
  }
  return [...rows.values()].sort((a, b) => a.manager.localeCompare(b.manager) || a.name.localeCompare(b.name));
}

function StatusBadge({ status }: { status: string }) {
  if (/working/i.test(status)) return <Badge tone="good">Working</Badge>;
  if (/exited|resigned/i.test(status)) return <Badge tone="critical">{status}</Badge>;
  return <Badge tone="neutral">{status || 'Unknown'}</Badge>;
}

export function TeamMappingPage({ dataset }: { dataset: Dataset }) {
  const [manager, setManager] = useState<string>(ALL);
  const [query, setQuery] = useState('');
  const [showExited, setShowExited] = useState(false);
  const [focus, setFocus] = useState<Focus>('none');
  const toggleFocus = (f: Focus) => setFocus((cur) => (cur === f ? 'none' : f));

  const rows = useMemo(() => buildRows(dataset), [dataset]);
  const managers = useMemo(() => [...new Set(rows.map((r) => r.manager).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [rows]);
  const isManagerRow = useMemo(() => new Set(managers.map((m) => m.toLowerCase())), [managers]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (manager === UNASSIGNED ? r.manager !== '' : manager !== ALL && r.manager !== manager) return false;
      if (!showExited && /exited|resigned/i.test(r.status) && !r.lastCall) return false;
      if (!FOCUS_TEST[focus](r)) return false;
      if (q && !(r.name.toLowerCase().includes(q) || r.empNo.toLowerCase().includes(q) || r.manager.toLowerCase().includes(q) || r.title.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, manager, query, showExited, focus]);

  const grouped = useMemo(() => {
    const g = new Map<string, MappingRow[]>();
    for (const r of visible) { const k = r.manager || ''; const arr = g.get(k) ?? []; arr.push(r); g.set(k, arr); }
    return [...g.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0])));
  }, [visible]);

  // Same rule as the lists below: everyone except people who have exited and have no recent calls.
  const working = rows.filter((r) => !/exited|resigned/i.test(r.status) || r.lastCall);
  const kpis: KPI[] = [
    { key: 'managers', label: 'Managers', value: formatNumber(managers.length), sub: 'with at least one executive', description: 'Distinct managers in the HR directory for sales staff and for everyone with call data.' },
    { key: 'mapped', label: 'Executives Mapped', value: formatNumber(working.filter(FOCUS_TEST.mapped).length), sub: 'manager from the HR directory', description: 'Working executives whose manager comes from the icku directory.', onClick: () => toggleFocus('mapped'), active: focus === 'mapped' },
    { key: 'unassigned', label: 'Unassigned', value: formatNumber(working.filter(FOCUS_TEST.unassigned).length), sub: 'no manager in the directory', description: 'Working executives, or executives with recent calls, who have no manager in the HR directory.', onClick: () => toggleFocus('unassigned'), active: focus === 'unassigned' },
    { key: 'notInDir', label: 'Not In Directory', value: formatNumber(working.filter(FOCUS_TEST.notInDir).length), sub: 'have calls, unknown to HR', description: 'Executives with call data whose employee number is not in the icku directory.', onClick: () => toggleFocus('notInDir'), active: focus === 'notInDir' },
    { key: 'crm', label: 'CRM Team Differs', value: formatNumber(working.filter(FOCUS_TEST.crm).length), sub: 'Pending Tasks sheet says another team', description: 'Executives whose team in the CRM (Pending Tasks sheet, Users Reports) does not match their HR manager.', onClick: () => toggleFocus('crm'), active: focus === 'crm' },
    { key: 'idle', label: 'No Calls In 30 Days', value: formatNumber(working.filter(FOCUS_TEST.idle).length), sub: 'working per HR, no call data', description: 'Working executives per HR who have no call activity in the last 30 days.', onClick: () => toggleFocus('idle'), active: focus === 'idle' },
  ];

  if (!dataset.directory.length && !dataset.employees.length) return <EmptyState title="No team mapping available" message="The HR directory has not been read yet and no executives were found in the call data." />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-card dark:border-line-dark dark:bg-surface-dark">
        <div className="text-xs text-ink-secondary dark:text-ink-dark-secondary">
          <span className="font-medium text-ink dark:text-ink-dark">Team mapping</span>
          {dataset.directory.length ? <> · from the icku HR directory{dataset.meta.directoryAsOf ? <>, read {formatTimestampIST(dataset.meta.directoryAsOf)}</> : null}</> : <> · from the Employee Data tab of the sheet (HR directory not connected)</>}
          <div className="mt-0.5 text-ink-muted">Managers and their executives as the dashboard uses them. To correct a mapping, update "Reporting To" in icku; the dashboard follows at the next sync.</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select ariaLabel="Manager" value={manager} onChange={setManager} options={[{ value: ALL, label: 'All managers' }, { value: UNASSIGNED, label: 'Unassigned' }, ...managers.map((m) => ({ value: m, label: m }))]} className="w-52" />
          <SearchInput value={query} onChange={setQuery} placeholder="Search name, number, title…" className="w-56" />
          <label className="flex items-center gap-1.5 text-xs text-ink-secondary dark:text-ink-dark-secondary"><input type="checkbox" checked={showExited} onChange={(e) => setShowExited(e.target.checked)} /> Show exited</label>
        </div>
      </div>

      <KPIGrid kpis={kpis} />
      {focus !== 'none' && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-accent/40 bg-accent-soft/40 px-4 py-2 text-xs text-ink dark:bg-accent-soft-dark/30 dark:text-ink-dark">
          <span>Showing <span className="font-medium">{FOCUS_LABEL[focus]}</span> · {formatNumber(visible.length)} {visible.length === 1 ? 'person' : 'people'}{manager !== ALL ? ' in the selected manager' : ''}</span>
          <Button size="sm" variant="ghost" onClick={() => setFocus('none')}>Show everyone</Button>
        </div>
      )}

      {grouped.length === 0 && <EmptyState title="Nobody matches" message="Try another manager or clear the search." />}
      {grouped.map(([mgr, list]) => (
        <Card key={mgr || UNASSIGNED} title={mgr ? <span>{mgr}{isManagerRow.has(mgr.toLowerCase()) ? '' : ''}</span> : 'Unassigned · no manager on record'} subtitle={`${formatNumber(list.length)} ${list.length === 1 ? 'person' : 'people'}${mgr ? '' : ' · these executives do not appear under any manager in the dashboard filters'}`} bodyClassName="!px-0 !py-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted dark:border-line-dark">
                  <th className="px-3 py-2 font-medium">Emp no</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Title</th>
                  <th className="px-3 py-2 font-medium">Location</th>
                  <th className="px-3 py-2 font-medium">HR status</th>
                  <th className="px-3 py-2 font-medium">CRM team</th>
                  <th className="px-3 py-2 font-medium">Last call</th>
                  <th className="px-3 py-2 font-medium">Check</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.empNo} className="border-b border-line last:border-0 dark:border-line-dark">
                    <td className="px-3 py-1.5 text-ink-muted">{r.empNo.startsWith('NAME:') ? '–' : r.empNo}</td>
                    <td className="px-3 py-1.5 text-ink dark:text-ink-dark">{r.name}</td>
                    <td className="px-3 py-1.5 text-ink-secondary dark:text-ink-dark-secondary">{r.title || '–'}</td>
                    <td className="px-3 py-1.5 text-ink-secondary dark:text-ink-dark-secondary">{r.location || '–'}</td>
                    <td className="px-3 py-1.5"><StatusBadge status={r.status} /></td>
                    <td className="px-3 py-1.5 text-ink-secondary dark:text-ink-dark-secondary">{r.crmTeam ? teamLabel(r.crmTeam) : '–'}</td>
                    <td className="px-3 py-1.5 text-ink-secondary dark:text-ink-dark-secondary">{r.lastCall ? formatDate(r.lastCall) : '–'}</td>
                    <td className="px-3 py-1.5">
                      {r.flags.length === 0 ? <Badge tone="good">OK</Badge> : <div className="flex flex-wrap gap-1">{r.flags.map((f) => <Badge key={f} tone={f.startsWith('No calls') ? 'neutral' : 'warning'}>{f}</Badge>)}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}
