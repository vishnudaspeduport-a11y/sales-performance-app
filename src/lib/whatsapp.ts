import { formatNumber } from './format';
import { overdueOf, todayOf, type PendingOwnerRow, type PendingTeamRow } from './pending';

/**
 * Pending-task reports as WhatsApp text, opened in the user's own WhatsApp through a wa.me link
 * so they choose the recipient and press send. Same wording as the automatic digest.
 */

const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Address managers should open; the manager view when the page is served, else nothing. */
function dashboardLink(): string {
  try { if (/^https?:/.test(window.location.origin) && !/localhost|127\.0\.0\.1/.test(window.location.host)) return `${window.location.origin}/?view=manager`; } catch { /* ignore */ }
  return 'https://eduportsales.vishnudasp-eduport.workers.dev/?view=manager';
}

/** One team: totals, overdue per executive and the top five executives by overdue. */
export function teamReportText(team: PendingTeamRow, owners: PendingOwnerRow[], date: string): string {
  const overdue = overdueOf(team); const today = todayOf(team);
  const top = [...owners].sort((a, b) => overdueOf(b) - overdueOf(a) || b.total - a.total).slice(0, 5);
  const lines = [
    `*Pending tasks · ${team.label} · ${longDate(date)}*`,
    `Overdue: *${formatNumber(overdue)}* (IC ${formatNumber(team.icOverdue)}, LM ${formatNumber(team.lmOverdue)}) · Due today: ${formatNumber(today)} · Executives with tasks: ${formatNumber(team.bdes)}`,
  ];
  if (team.bdes) lines.push(`${formatNumber(overdue / team.bdes, 1)} overdue per executive`);
  if (top.length) {
    lines.push('', `Top ${top.length} by overdue:`);
    top.forEach((o, i) => lines.push(`${i + 1}. ${o.owner}: ${formatNumber(overdueOf(o))} overdue, ${formatNumber(todayOf(o))} today`));
  }
  lines.push('', `Dashboard: ${dashboardLink()}`);
  return lines.join('\n');
}

/** Every team on one message, for the sales head or the managers' group. */
export function allTeamsReportText(teams: PendingTeamRow[], date: string): string {
  const withPeople = teams.filter((t) => t.bdes > 0);
  const overdue = withPeople.reduce((s, t) => s + overdueOf(t), 0);
  const today = withPeople.reduce((s, t) => s + todayOf(t), 0);
  const bdes = withPeople.reduce((s, t) => s + t.bdes, 0);
  const lines = [
    `*Pending tasks · all teams · ${longDate(date)}*`,
    `Overdue: *${formatNumber(overdue)}* · Due today: ${formatNumber(today)} · Executives with tasks: ${formatNumber(bdes)}`,
    '',
  ];
  for (const t of withPeople) lines.push(`${t.label}: ${formatNumber(overdueOf(t))} overdue, ${formatNumber(todayOf(t))} today, ${formatNumber(t.bdes)} executives, ${formatNumber(overdueOf(t) / t.bdes, 1)} per executive`);
  lines.push('', `Dashboard: ${dashboardLink()}`);
  return lines.join('\n');
}

/** Open WhatsApp (app or web) with the text ready to send; the user picks the chat. */
export function shareOnWhatsApp(text: string): void {
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  const w = window.open(url, '_blank', 'noopener');
  if (!w) window.location.href = url;
}
