import type { PendingRow, PendingSnapshot, PendingTeamDay } from '../types';

export type PendingBucket = 'today' | 'overdue' | 'upcoming';

export interface PendingTotals {
  icToday: number;
  icOverdue: number;
  lmToday: number;
  lmOverdue: number;
  upcoming: number;
  total: number;
}

export interface PendingTeamRow extends PendingTotals {
  team: string;
  label: string;
  /** executives with at least one pending task */
  bdes: number;
  perBde: number | null;
}

export interface PendingOwnerRow extends PendingTotals {
  owner: string;
}

export const ALL_SUBJECTS = '__all__';

/** "Executive-Team Aswanth" → "Team Aswanth"; other roles are shown as they are. */
export function teamLabel(team: string): string {
  const m = /^executive[\s_-]*team[\s_-]*(.+)$/i.exec(team.trim());
  if (m) return `Team ${m[1].trim()}`;
  return team.trim() || '(no team)';
}

function emptyTotals(): PendingTotals {
  return { icToday: 0, icOverdue: 0, lmToday: 0, lmOverdue: 0, upcoming: 0, total: 0 };
}

function add(t: PendingTotals, r: PendingRow) {
  if (r.bucket === 'upcoming') { t.upcoming += r.count; return; }
  if (r.source === 'IC') { if (r.bucket === 'today') t.icToday += r.count; else t.icOverdue += r.count; }
  else if (r.bucket === 'today') t.lmToday += r.count; else t.lmOverdue += r.count;
  t.total += r.count;
}

export function filterRows(snapshot: PendingSnapshot, subject: string): PendingRow[] {
  return subject === ALL_SUBJECTS ? snapshot.rows : snapshot.rows.filter((r) => r.subject === subject);
}

/** Sheet DB block 2: one row per team (owner role). */
export function aggregateTeams(rows: PendingRow[]): PendingTeamRow[] {
  const byTeam = new Map<string, { totals: PendingTotals; owners: Set<string> }>();
  for (const r of rows) {
    let t = byTeam.get(r.team);
    if (!t) { t = { totals: emptyTotals(), owners: new Set() }; byTeam.set(r.team, t); }
    add(t.totals, r);
    if (r.bucket !== 'upcoming') t.owners.add(r.owner);
  }
  return [...byTeam.entries()]
    .map(([team, { totals, owners }]) => ({ team, label: teamLabel(team), bdes: owners.size, perBde: owners.size ? totals.total / owners.size : null, ...totals }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

/** Sheet DB block 4: one row per executive inside a team. */
export function aggregateOwners(rows: PendingRow[], team: string): PendingOwnerRow[] {
  const byOwner = new Map<string, PendingTotals>();
  for (const r of rows) {
    if (r.team !== team) continue;
    let t = byOwner.get(r.owner);
    if (!t) { t = emptyTotals(); byOwner.set(r.owner, t); }
    add(t, r);
  }
  return [...byOwner.entries()].map(([owner, t]) => ({ owner, ...t })).sort((a, b) => b.total - a.total || a.owner.localeCompare(b.owner));
}

export function sumTotals(rows: PendingTotals[]): PendingTotals {
  const t = emptyTotals();
  for (const r of rows) { t.icToday += r.icToday; t.icOverdue += r.icOverdue; t.lmToday += r.lmToday; t.lmOverdue += r.lmOverdue; t.upcoming += r.upcoming; t.total += r.total; }
  return t;
}

/** Day-over-day totals, optionally for one team. */
export function historySeries(history: PendingTeamDay[], team: string | null): { date: string; icToday: number; icOverdue: number; lmToday: number; lmOverdue: number; total: number }[] {
  const byDate = new Map<string, { date: string; icToday: number; icOverdue: number; lmToday: number; lmOverdue: number; total: number }>();
  for (const h of history) {
    if (team && h.team !== team) continue;
    let d = byDate.get(h.date);
    if (!d) { d = { date: h.date, icToday: 0, icOverdue: 0, lmToday: 0, lmOverdue: 0, total: 0 }; byDate.set(h.date, d); }
    d.icToday += h.icToday; d.icOverdue += h.icOverdue; d.lmToday += h.lmToday; d.lmOverdue += h.lmOverdue;
    d.total += h.icToday + h.icOverdue + h.lmToday + h.lmOverdue;
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}
