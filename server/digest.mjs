/**
 * Morning digest of pending CRM tasks, one message per manager (team) plus an all-teams
 * summary for whoever gets team "*". Built from the dashboard payload's `pending` section,
 * so the numbers match the Pending Tasks page. By default every task of an executive counts,
 * resigned executives left out (the By executive rule); DIGEST_RULE=owner switches the team
 * figures to the sheet's team-block rule (assigned to the lead's owner, owner not resigned).
 *
 * Only counts, team names and executive names leave this module.
 */

const AGES = { d1_3: 'age1_3', d4_7: 'age4_7', d8p: 'age8p' };

/** "Executive-Team Aswanth" → "Team Aswanth" (same as the dashboard). */
export function teamLabel(team) {
  const m = /^executive[\s_-]*team[\s_-]*(.+)$/i.exec(String(team).trim());
  return m ? `Team ${m[1].trim()}` : String(team).trim() || '(no team)';
}

const key = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9*]/g, '');

/** Does a recipient's team setting ("Team Aswanth", "Aswanth", the full role, or "*") match a team? */
export function teamMatches(setting, team) {
  const s = key(setting);
  if (!s) return false;
  if (s === '*') return true;
  const full = key(team), label = key(teamLabel(team)), bare = key(teamLabel(team).replace(/^Team\s+/i, ''));
  return s === full || s === label || s === bare || s === key('Team ' + setting);
}

function empty() { return { today: 0, overdue: 0, upcoming: 0, total: 0, age1_3: 0, age4_7: 0, age8p: 0, icToday: 0, icOverdue: 0, lmToday: 0, lmOverdue: 0 }; }
function add(t, source, bucket, age, count) {
  if (bucket === 'upcoming') { t.upcoming += count; return; }
  t.total += count;
  if (bucket === 'today') { t.today += count; t[source === 'IC' ? 'icToday' : 'lmToday'] += count; return; }
  t.overdue += count; t[source === 'IC' ? 'icOverdue' : 'lmOverdue'] += count;
  if (AGES[age]) t[AGES[age]] += count;
}

/** Same rule as the dashboard: good under target, warning at target, critical at twice the target. */
export function targetTone(overdue, executives, target) {
  if (!executives || !(target > 0)) return 'neutral';
  const per = overdue / executives;
  return per >= target * 2 ? 'critical' : per >= target ? 'warning' : 'good';
}
const TONE_LABEL = { good: 'On target', warning: 'Watch', critical: 'Over target', neutral: '–' };

/**
 * @param {object} pending  payload.pending: { date, rows: [source, team, owner, subject, bucket, kind, age?, count], ... }
 * @param {{ target?: number, top?: number }} [opts]
 * @returns {{ date: string, target: number, teams: TeamDigest[] }}
 */
export function buildDigest(pending, opts = {}) {
  const target = opts.target > 0 ? opts.target : 5;
  const top = opts.top > 0 ? opts.top : 5;
  // 'exec' (default): every task of the executive, resigned executives left out, for team and executive figures alike.
  // 'owner': the sheet's team-block rule (assigned to the lead's owner, owner not resigned) for the team figures.
  const teamRule = opts.rule === 'owner' ? (k) => k === 'owner' : (k) => k !== 'resigned';
  const teams = new Map();
  for (const row of pending.rows || []) {
    const [source, team, owner, subject, bucket, kind] = row;
    const age = row.length >= 8 ? row[6] : '';
    const count = Number(row[row.length - 1]) || 0;
    let t = teams.get(team);
    if (!t) { t = { team, label: teamLabel(team), totals: empty(), owners: new Map(), subjects: new Map() }; teams.set(team, t); }
    if (teamRule(kind)) {
      add(t.totals, source, bucket, age, count);
      if (bucket !== 'upcoming') { const s = t.subjects.get(subject) || empty(); add(s, source, bucket, age, count); t.subjects.set(subject, s); }
    }
    if (kind !== 'resigned') { // per-executive rule
      let o = t.owners.get(owner);
      if (!o) { o = { owner, ...empty() }; t.owners.set(owner, o); }
      add(o, source, bucket, age, count);
    }
  }
  const out = [...teams.values()].map((t) => {
    const owners = [...t.owners.values()].filter((o) => o.total > 0).sort((a, b) => b.overdue - a.overdue || b.total - a.total || a.owner.localeCompare(b.owner));
    const bdes = owners.length;
    return {
      team: t.team, label: t.label, bdes, ...t.totals,
      perExec: bdes ? t.totals.overdue / bdes : null,
      tone: targetTone(t.totals.overdue, bdes, target),
      top: owners.slice(0, top),
      subjects: [...t.subjects.entries()].map(([subject, s]) => ({ subject, ...s })).sort((a, b) => b.total - a.total),
    };
  }).sort((a, b) => b.overdue - a.overdue || a.label.localeCompare(b.label));
  return { date: pending.date, target, teams: out };
}

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dateText = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const TONE_COLOR = { good: '#0ca30c', warning: '#c98500', critical: '#d03b3b', neutral: '#898781' };
const TONE_BG = { good: '#e6f5e6', warning: '#fff3d6', critical: '#fbe4e4', neutral: '#f4f4f2' };

function ageText(t) {
  const known = t.age1_3 + t.age4_7 + t.age8p > 0;
  return known ? `${fmt(t.age1_3)} overdue 1–3 days · ${fmt(t.age4_7)} 4–7 days · ${fmt(t.age8p)} 8 days or more` : '';
}

/**
 * Parameters for a WhatsApp message template, in order: {{1}} team, {{2}} date, {{3}} overdue,
 * {{4}} due today, {{5}} executives with tasks, {{6}} top executives by overdue (one line).
 * Template parameters may not contain line breaks, so the top list is comma-separated.
 */
export function templateParams(d, digest) {
  const top = d.top.length ? d.top.map((o) => `${o.owner} ${fmt(o.overdue)}`).join(', ') : 'none';
  return [d.label, dateText(digest.date), fmt(d.overdue), fmt(d.today), String(d.bdes), top.slice(0, 900)];
}

/** Same six parameters for the all-teams summary: {{6}} lists teams instead of executives. */
export function summaryTemplateParams(digest) {
  const teams = digest.teams.filter((t) => t.bdes);
  const tot = teams.reduce((a, t) => ({ overdue: a.overdue + t.overdue, today: a.today + t.today, bdes: a.bdes + t.bdes }), { overdue: 0, today: 0, bdes: 0 });
  const list = teams.map((t) => `${t.label} ${fmt(t.overdue)}`).join(', ');
  return ['All teams', dateText(digest.date), fmt(tot.overdue), fmt(tot.today), String(tot.bdes), list.slice(0, 900) || 'none'];
}

/** Plain-text digest for one team (WhatsApp / SMS / the email's text part). */
export function renderTeamText(d, digest, url) {
  const lines = [];
  lines.push(`*Pending tasks · ${d.label} · ${dateText(digest.date)}*`);
  lines.push(`Overdue: *${fmt(d.overdue)}* (IC ${fmt(d.icOverdue)}, LM ${fmt(d.lmOverdue)}) · Due today: ${fmt(d.today)} · Executives with tasks: ${d.bdes}`);
  if (d.perExec != null) lines.push(`${d.perExec.toFixed(1)} overdue per executive`);
  const age = ageText(d); if (age) lines.push(age);
  if (d.top.length) {
    lines.push('');
    lines.push(`Top ${d.top.length} by overdue:`);
    d.top.forEach((o, i) => lines.push(`${i + 1}. ${o.owner}: ${fmt(o.overdue)} overdue, ${fmt(o.today)} today${o.age8p ? `, ${fmt(o.age8p)} over a week` : ''}`));
  }
  if (url) { lines.push(''); lines.push(`Dashboard: ${url}#/pending`); }
  return lines.join('\n');
}

/** Plain-text all-teams summary. */
export function renderSummaryText(digest, url) {
  const tot = digest.teams.reduce((a, t) => ({ overdue: a.overdue + t.overdue, today: a.today + t.today, bdes: a.bdes + t.bdes, age8p: a.age8p + t.age8p }), { overdue: 0, today: 0, bdes: 0, age8p: 0 });
  const lines = [`*Pending tasks · all teams · ${dateText(digest.date)}*`, `Overdue: *${fmt(tot.overdue)}* · Due today: ${fmt(tot.today)} · Executives with tasks: ${tot.bdes}${tot.age8p ? ` · ${fmt(tot.age8p)} overdue for 8+ days` : ''}`, ''];
  for (const t of digest.teams) if (t.bdes) lines.push(`${t.label}: ${fmt(t.overdue)} overdue, ${fmt(t.today)} today, ${t.bdes} executives, ${t.perExec.toFixed(1)} per executive`);
  if (url) { lines.push(''); lines.push(`Dashboard: ${url}#/pending`); }
  return lines.join('\n');
}

function shell(title, body, url) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title></head>
<body style="margin:0;background:#f4f4f2;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#0b0b0b;font-size:14px;line-height:1.45">
<div style="max-width:640px;margin:0 auto;padding:20px 12px">
<div style="background:#fcfcfb;border:1px solid #e1e0d9;border-radius:12px;overflow:hidden">
<div style="background:#2a78d6;color:#fff;padding:14px 20px"><div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">Eduport Sales · Pending Tasks</div><div style="font-size:18px;font-weight:600;margin-top:2px">${esc(title)}</div></div>
${body}
<div style="padding:12px 20px;border-top:1px solid #e1e0d9;font-size:11px;color:#898781">Sent every morning from the sales dashboard. Counts every task of an executive, resigned executives left out, the same as the dashboard's By executive list.${url ? ` <a href="${esc(url)}#/pending" style="color:#2a78d6">Open the dashboard</a>.` : ''}</div>
</div></div></body></html>`;
}

const tile = (label, value, sub, color) => `<td style="padding:6px" width="33%"><div style="border:1px solid #e1e0d9;border-top:3px solid ${color};border-radius:8px;padding:10px 12px"><div style="font-size:11px;color:#898781">${esc(label)}</div><div style="font-size:22px;font-weight:600;margin-top:2px">${value}</div>${sub ? `<div style="font-size:11px;color:#898781;margin-top:2px">${esc(sub)}</div>` : ''}</div></td>`;
const badge = (tone) => `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:${TONE_BG[tone]};color:${TONE_COLOR[tone]}">${TONE_LABEL[tone]}</span>`;
const th = (t, right = true) => `<th style="text-align:${right ? 'right' : 'left'};padding:6px 8px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#898781;border-bottom:1px solid #e1e0d9;font-weight:600">${esc(t)}</th>`;
const td = (v, opts = {}) => `<td style="text-align:${opts.left ? 'left' : 'right'};padding:6px 8px;border-bottom:1px solid #eeede8;${opts.strong ? 'font-weight:600;' : ''}${opts.muted ? 'color:#898781;' : ''}font-variant-numeric:tabular-nums">${v}</td>`;

/** HTML email for one team. */
export function renderTeamHtml(d, digest, url) {
  const age = ageText(d);
  const body = `
<div style="padding:16px 20px 4px"><div style="font-size:13px;color:#52514e">${esc(dateText(digest.date))} · ${d.bdes} executives with tasks · target under ${digest.target} overdue per executive · ${badge(d.tone)}</div></div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:6px 14px"><tr>
${tile('Overdue (till yesterday)', fmt(d.overdue), `IC ${fmt(d.icOverdue)} · LM ${fmt(d.lmOverdue)}`, TONE_COLOR[d.tone])}
${tile('Due today', fmt(d.today), `IC ${fmt(d.icToday)} · LM ${fmt(d.lmToday)}`, '#2a78d6')}
${tile('Overdue per executive', d.perExec == null ? '–' : d.perExec.toFixed(1), age ? `${fmt(d.age8p)} overdue for 8+ days` : 'target under ' + digest.target, '#7c5cd6')}
</tr></table>
${age ? `<div style="padding:0 20px 8px;font-size:12px;color:#52514e">${esc(age)}</div>` : ''}
<div style="padding:8px 20px 4px;font-size:13px;font-weight:600">Top ${d.top.length} executives by overdue</div>
<table width="100%" cellspacing="0" cellpadding="0" style="padding:0 12px 8px"><tr>${th('#', false)}${th('Executive', false)}${th('Overdue')}${th('Today')}${th('8+ days')}${th('Total')}</tr>
${d.top.map((o, i) => `<tr>${td(i + 1, { left: true, muted: true })}${td(esc(o.owner), { left: true, strong: true })}${td(fmt(o.overdue), { strong: true })}${td(fmt(o.today))}${td(o.age8p ? fmt(o.age8p) : '–', { muted: !o.age8p })}${td(fmt(o.total))}</tr>`).join('')}
${d.top.length === 0 ? `<tr>${td('No pending tasks. Well done.', { left: true, muted: true })}</tr>` : ''}
</table>
${d.subjects.length ? `<div style="padding:8px 20px 4px;font-size:13px;font-weight:600">By subject</div>
<table width="100%" cellspacing="0" cellpadding="0" style="padding:0 12px 12px"><tr>${th('Subject', false)}${th('Overdue')}${th('Today')}${th('Total')}</tr>
${d.subjects.map((s) => `<tr>${td(esc(s.subject), { left: true })}${td(fmt(s.overdue))}${td(fmt(s.today))}${td(fmt(s.total), { strong: true })}</tr>`).join('')}</table>` : ''}`;
  return shell(`${d.label}: ${fmt(d.overdue)} overdue, ${fmt(d.today)} due today`, body, url);
}

/** HTML email with every team, for the sales head. */
export function renderSummaryHtml(digest, url) {
  const teams = digest.teams.filter((t) => t.bdes > 0);
  const tot = teams.reduce((a, t) => ({ overdue: a.overdue + t.overdue, today: a.today + t.today, bdes: a.bdes + t.bdes, age8p: a.age8p + t.age8p }), { overdue: 0, today: 0, bdes: 0, age8p: 0 });
  const over = teams.filter((t) => t.tone !== 'good').length;
  const body = `
<div style="padding:16px 20px 4px"><div style="font-size:13px;color:#52514e">${esc(dateText(digest.date))} · ${teams.length} teams · target under ${digest.target} overdue per executive</div></div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:6px 14px"><tr>
${tile('Overdue (till yesterday)', fmt(tot.overdue), tot.age8p ? `${fmt(tot.age8p)} for 8+ days` : '', '#d03b3b')}
${tile('Due today', fmt(tot.today), `${tot.bdes} executives with tasks`, '#2a78d6')}
${tile('Teams over target', fmt(over), `of ${teams.length}`, over ? '#c98500' : '#0ca30c')}
</tr></table>
<table width="100%" cellspacing="0" cellpadding="0" style="padding:8px 12px 12px"><tr>${th('Team', false)}${th('Exec')}${th('Overdue')}${th('Today')}${th('8+ d')}${th('Per exec')}${th('Status')}</tr>
${teams.map((t) => `<tr>${td(esc(t.label), { left: true, strong: true })}${td(t.bdes)}${td(fmt(t.overdue), { strong: true })}${td(fmt(t.today))}${td(t.age8p ? fmt(t.age8p) : '–', { muted: !t.age8p })}${td(t.perExec.toFixed(1))}${td(badge(t.tone))}</tr>`).join('')}
</table>`;
  return shell(`All teams: ${fmt(tot.overdue)} overdue, ${fmt(tot.today)} due today`, body, url);
}

/**
 * Work out who gets what. recipients: [{ team: 'Team Aswanth' | 'Executive-Team Aswanth' | '*', email?, whatsapp?, name? }]
 * Returns one message per recipient entry with subject, html and text ready to send.
 */
export function planMessages(digest, recipients, url) {
  const out = [];
  for (const r of recipients || []) {
    if (!r || (!r.email && !r.whatsapp)) continue;
    if (String(r.team).trim() === '*') {
      out.push({ to: r, team: '*', subject: `Pending tasks · all teams · ${digest.date}`, html: renderSummaryHtml(digest, url), text: renderSummaryText(digest, url), params: summaryTemplateParams(digest) });
      continue;
    }
    const teams = digest.teams.filter((t) => teamMatches(r.team, t.team));
    if (!teams.length) { out.push({ to: r, team: r.team, skipped: `no team in the snapshot matches "${r.team}"` }); continue; }
    for (const t of teams) out.push({ to: r, team: t.team, subject: `Pending tasks · ${t.label} · ${digest.date}: ${fmt(t.overdue)} overdue`, html: renderTeamHtml(t, digest, url), text: renderTeamText(t, digest, url), params: templateParams(t, digest) });
  }
  return out;
}
