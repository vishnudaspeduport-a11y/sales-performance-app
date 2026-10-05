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
const OUTSIDE_MGR = '__outside__';
const ALL = '__all__';
const RECENT_DAYS = 30;

type Focus = 'none' | 'mapped' | 'unassigned' | 'notInDir' | 'crm' | 'idle' | 'unknown' | 'outside';
const FOCUS_LABEL: Record<Focus, string> = { none: '', mapped: 'Executives mapped from the HR directory', unassigned: 'Unassigned · no manager in the directory', notInDir: 'Not in the HR directory', crm: 'CRM team differs from the HR manager', idle: `No calls in ${RECENT_DAYS} days`, unknown: 'In Raw data but not in icku', outside: 'Callers outside the sales department' };
const FOCUS_TEST: Record<Focus, (r: MappingRow) => boolean> = {
  none: () => true,
  mapped: (r) => !!r.manager && r.source === 'directory',
  unassigned: (r) => !r.manager,
  notInDir: (r) => r.source !== 'directory',
  crm: (r) => r.flags.some((f) => f.startsWith('CRM team differs')),
  idle: (r) => r.flags.some((f) => f.startsWith('No calls')),
  unknown: () => false,
  outside: () => false,
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

/** Someone the dashboard should still show: Working per icku, or with calls in the last RECENT_DAYS days. */
const isActive = (r: MappingRow) => /working/i.test(r.status) || !!r.lastCall;

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
  // Managers offered in the filter: people who are themselves listed (sales department) and manage someone active.
  const listedNames = useMemo(() => new Set(rows.map((r) => r.name)), [rows]);
  const managers = useMemo(() => [...new Set(rows.filter(isActive).map((r) => r.manager).filter((m) => m && listedNames.has(m)))].sort((a, b) => a.localeCompare(b)), [rows, listedNames]);
  // Group key: the manager when listed, a shared "outside sales" group when the manager is not in the sales department.
  const groupOf = (r: MappingRow) => (r.manager ? (listedNames.has(r.manager) ? r.manager : OUTSIDE_MGR) : '');
  const isManagerRow = useMemo(() => new Set(managers.map((m) => m.toLowerCase())), [managers]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (manager === UNASSIGNED ? r.manager !== '' : manager === OUTSIDE_MGR ? groupOf(r) !== OUTSIDE_MGR : manager !== ALL && r.manager !== manager) return false;
      // People who are not Working in icku and have had no calls in ${RECENT_DAYS} days are old records; hide them unless asked.
      if (!showExited && !isActive(r)) return false;
      if (!FOCUS_TEST[focus](r)) return false;
      if (q && !(r.name.toLowerCase().includes(q) || r.empNo.toLowerCase().includes(q) || r.manager.toLowerCase().includes(q) || r.title.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, manager, query, showExited, focus]);

  const grouped = useMemo(() => {
    const g = new Map<string, MappingRow[]>();
    for (const r of visible) { const k = groupOf(r); const arr = g.get(k) ?? []; arr.push(r); g.set(k, arr); }
    const rank = (k: string) => (k === '' ? 2 : k === OUTSIDE_MGR ? 1 : 0);
    return [...g.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
  }, [visible]);

  // Same rule as the lists below: Working in icku, or calls in the last ${RECENT_DAYS} days.
  const working = rows.filter(isActive);
  // Call-log rows the sync dropped because the Emp Code is not in icku (or, without icku, not in Helper - Raw).
  // Snapshots from before the per-day list carried [code, name, days, calls, last]; read those as totals only.
  const unknown = (dataset.meta.callLogUnknown ?? []).map((u) => (typeof u[2] === 'number' ? [u[0], u[1], '', {}, Number(u[3]) || 0] as typeof u : u));
  const checkedAgainst = dataset.meta.callLogCheckedAgainst === 'helper' ? 'Helper - Raw' : 'icku';
  const unknownCalls = unknown.reduce((s, u) => s + u[4], 0);
  const outside = dataset.meta.callLogOutsideSales ?? [];
  const outsideCalls = outside.reduce((s, u) => s + u[5], 0);
  const unknownDates = dataset.meta.callLogUnknownDates ?? [...new Set(unknown.flatMap((u) => Object.keys(u[3])))].sort().reverse();
  const kpis: KPI[] = [
    { key: 'managers', tone: 'blue', label: 'Managers', value: formatNumber(managers.length), sub: 'with at least one executive', description: 'Distinct managers in the HR directory for sales staff and for everyone with call data.' },
    { key: 'mapped', tone: 'green', label: 'Executives Mapped', value: formatNumber(working.filter(FOCUS_TEST.mapped).length), sub: 'manager from the HR directory', description: 'Working executives whose manager comes from the icku directory.', onClick: () => toggleFocus('mapped'), active: focus === 'mapped' },
    { key: 'unassigned', tone: 'amber', label: 'Unassigned', value: formatNumber(working.filter(FOCUS_TEST.unassigned).length), sub: 'no manager in the directory', description: 'Working executives, or executives with recent calls, who have no manager in the HR directory.', onClick: () => toggleFocus('unassigned'), active: focus === 'unassigned' },
    { key: 'notInDir', tone: 'red', label: 'Not In Directory', value: formatNumber(working.filter(FOCUS_TEST.notInDir).length), sub: 'have calls, unknown to HR', description: 'Executives with call data whose employee number is not in the icku directory.', onClick: () => toggleFocus('notInDir'), active: focus === 'notInDir' },
    { key: 'crm', tone: 'violet', label: 'CRM Team Differs', value: formatNumber(working.filter(FOCUS_TEST.crm).length), sub: 'Pending Tasks sheet says another team', description: 'Executives whose team in the CRM (Pending Tasks sheet, Users Reports) does not match their HR manager.', onClick: () => toggleFocus('crm'), active: focus === 'crm' },
    { key: 'unknown', tone: 'red', label: `In Raw Data, Not In ${checkedAgainst}`, value: formatNumber(unknown.length), sub: unknown.length ? `${formatNumber(unknownCalls)} calls left out of the dashboard` : 'every Emp Code in the call log is known', description: `Emp Codes in the Raw data call log that are not in ${checkedAgainst}. Their calls are left out until the code is added there.`, onClick: () => toggleFocus('unknown'), active: focus === 'unknown' },
    ...(dataset.meta.salesDepartmentOnly ? [{ key: 'outside', tone: 'amber' as const, label: 'Outside Sales Dept', value: formatNumber(outside.length), sub: outside.length ? `${formatNumber(outsideCalls)} calls left out` : 'every caller is in the sales department', description: 'People who make calls through Callyzer but whose icku department is not sales. The dashboard leaves their calls out.', onClick: () => toggleFocus('outside'), active: focus === 'outside' }] : []),
    { key: 'idle', tone: 'slate', label: 'No Calls In 30 Days', value: formatNumber(working.filter(FOCUS_TEST.idle).length), sub: 'working per HR, no call data', description: 'Working executives per HR who have no call activity in the last 30 days.', onClick: () => toggleFocus('idle'), active: focus === 'idle' },
  ];

  if (!dataset.directory.length && !dataset.employees.length) return <EmptyState title="No team mapping available" message="The HR directory has not been read yet and no executives were found in the call data." />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-transparent bg-surface px-4 py-3 shadow-card dark:border-line-dark dark:bg-surface-dark">
        <div className="text-xs text-ink-secondary dark:text-ink-dark-secondary">
          <span className="font-medium text-ink dark:text-ink-dark">Team mapping</span>
          {dataset.directory.length ? <> · from the icku HR directory{dataset.meta.directoryAsOf ? <>, read {formatTimestampIST(dataset.meta.directoryAsOf)}</> : null}</> : <> · from the Employee Data tab of the sheet (HR directory not connected)</>}
          <div className="mt-0.5 text-ink-muted">Managers and their executives as the dashboard uses them. To correct a mapping, update "Reporting To" in icku; the dashboard follows at the next sync.</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select ariaLabel="Manager" value={manager} onChange={setManager} options={[{ value: ALL, label: 'All managers' }, { value: UNASSIGNED, label: 'Unassigned' }, { value: OUTSIDE_MGR, label: 'Reports outside sales' }, ...managers.map((m) => ({ value: m, label: m }))]} className="w-52" />
          <SearchInput value={query} onChange={setQuery} placeholder="Search name, number, title…" className="w-56" />
          <label className="flex items-center gap-1.5 text-xs text-ink-secondary dark:text-ink-dark-secondary"><input type="checkbox" checked={showExited} onChange={(e) => setShowExited(e.target.checked)} /> Show exited and inactive</label>
        </div>
      </div>

      <KPIGrid kpis={kpis} />
      {focus !== 'none' && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-accent/40 bg-accent-soft/40 px-4 py-2 text-xs text-ink dark:bg-accent-soft-dark/30 dark:text-ink-dark">
          <span>Showing <span className="font-medium">{FOCUS_LABEL[focus]}</span> · {focus === 'unknown' ? `${formatNumber(unknown.length)} Emp ${unknown.length === 1 ? 'Code' : 'Codes'}` : focus === 'outside' ? `${formatNumber(outside.length)} ${outside.length === 1 ? 'person' : 'people'}` : `${formatNumber(visible.length)} ${visible.length === 1 ? 'person' : 'people'}${manager !== ALL ? ' in the selected manager' : ''}`}</span>
          <Button size="sm" variant="ghost" onClick={() => setFocus('none')}>Show everyone</Button>
        </div>
      )}

      {focus === 'unknown' && (
        <Card title={`In Raw data but not in ${checkedAgainst}`} subtitle={`${formatNumber(unknown.length)} Emp Codes from the call log with no match in ${checkedAgainst}${unknownDates.length ? ` · ${unknownDates.map((d) => formatDate(d, false)).join(' and ')}` : ''} · their calls are not counted anywhere on the dashboard · fix the code in Callyzer or add the person in ${checkedAgainst}`} bodyClassName="!px-0 !py-0">
          {unknown.length === 0 ? <EmptyState title="Nothing left out" message={`Every Emp Code in the Raw data call log was found in ${checkedAgainst}.`} /> : (
            <div className="overflow-x-auto">
              <table className="zebra w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted dark:border-line-dark">
                    <th className="px-3 py-2 font-medium">Emp code in Raw data</th>
                    <th className="px-3 py-2 font-medium">Name in Raw data</th>
                    <th className="px-3 py-2 font-medium" title="From the Helper - Raw manager row when the code is listed there, otherwise the first Emp Tag in the call log">Manager (from sheet / tag)</th>
                    {unknownDates.map((d) => <th key={d} className="px-3 py-2 text-right font-medium">Calls {formatDate(d, false)}</th>)}
                    <th className="px-3 py-2 text-right font-medium">Calls left out</th>
                  </tr>
                </thead>
                <tbody>
                  {unknown.map(([code, name, mgr, byDate, calls]) => (
                    <tr key={code || name} className="border-b border-line last:border-0 dark:border-line-dark">
                      <td className="px-3 py-1.5 text-ink dark:text-ink-dark">{code && !code.startsWith('NAME:') ? code : <span className="text-ink-muted">(no Emp Code)</span>}</td>
                      <td className="px-3 py-1.5 text-ink dark:text-ink-dark">{name || '–'}</td>
                      <td className="px-3 py-1.5 text-ink-secondary dark:text-ink-dark-secondary">{mgr || '–'}</td>
                      {unknownDates.map((d) => <td key={d} className={`tabular px-3 py-1.5 text-right ${byDate[d] ? '' : 'text-ink-muted'}`}>{formatNumber(byDate[d] ?? 0)}</td>)}
                      <td className="tabular px-3 py-1.5 text-right font-semibold text-ink dark:text-ink-dark">{formatNumber(calls)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {focus === 'outside' && (
        <Card title="Callers outside the sales department" subtitle={`${formatNumber(outside.length)} people with Callyzer calls on the latest call-log days whose icku department is not sales · their calls are not counted anywhere on the dashboard`} bodyClassName="!px-0 !py-0">
          {outside.length === 0 ? <EmptyState title="Nobody left out" message="Every caller on the latest call-log days is in the sales department." /> : (
            <div className="overflow-x-auto">
              <table className="zebra w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted dark:border-line-dark">
                    <th className="px-3 py-2 font-medium">Emp no</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Department (icku)</th>
                    <th className="px-3 py-2 font-medium">Title</th>
                    <th className="px-3 py-2 font-medium">Manager</th>
                    <th className="px-3 py-2 text-right font-medium">Calls left out</th>
                  </tr>
                </thead>
                <tbody>
                  {outside.map(([no, name, dept, title, mgr, calls]) => (
                    <tr key={no} className="border-b border-line last:border-0 dark:border-line-dark">
                      <td className="px-3 py-1.5 text-ink-muted">{no}</td>
                      <td className="px-3 py-1.5 text-ink dark:text-ink-dark">{name}</td>
                      <td className="px-3 py-1.5 text-ink-secondary dark:text-ink-dark-secondary">{dept || '–'}</td>
                      <td className="px-3 py-1.5 text-ink-secondary dark:text-ink-dark-secondary">{title || '–'}</td>
                      <td className="px-3 py-1.5 text-ink-secondary dark:text-ink-dark-secondary">{mgr || '–'}</td>
                      <td className="tabular px-3 py-1.5 text-right font-semibold text-ink dark:text-ink-dark">{formatNumber(calls)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {focus !== 'unknown' && focus !== 'outside' && grouped.length === 0 && <EmptyState title="Nobody matches" message="Try another manager or clear the search." />}
      {focus !== 'unknown' && focus !== 'outside' && grouped.map(([mgr, list]) => (
        <Card key={mgr || UNASSIGNED} title={mgr === OUTSIDE_MGR ? 'Reports outside the sales department' : mgr ? <span>{mgr}{isManagerRow.has(mgr.toLowerCase()) ? '' : ''}</span> : 'Unassigned · no manager on record'} subtitle={`${formatNumber(list.length)} ${list.length === 1 ? 'person' : 'people'}${mgr === OUTSIDE_MGR ? ` · sales staff whose manager in icku is not in the sales department: ${[...new Set(list.map((r) => r.manager))].join(', ')}` : mgr ? '' : ' · these executives do not appear under any manager in the dashboard filters'}`} bodyClassName="!px-0 !py-0">
          <div className="overflow-x-auto">
            <table className="zebra w-full min-w-[760px] text-sm">
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
