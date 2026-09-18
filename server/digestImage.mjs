/**
 * Pictures of the pending-task tables for WhatsApp, the same tables the Pending Tasks page
 * shows: the "By BDM team" table for the all-teams recipients and the "By executive" table
 * for a team's manager. Drawn as SVG and rasterised with resvg (no browser needed), so the
 * morning digest can attach them from GitHub Actions.
 *
 * Only counts, team names and executive names are drawn.
 */
import { Resvg } from '@resvg/resvg-js';

const FONT = "'Segoe UI', 'DejaVu Sans', Roboto, Arial, sans-serif";
const C = {
  bg: '#fcfcfb', card: '#ffffff', line: '#e6e5e0', ink: '#1a1a19', muted: '#6d6b66',
  head: '#f4f4f2', total: '#e8eef8', selected: '#eef3fb', ic: '#2f6bd8', icBg: '#e6eefb', lm: '#1d8f5a', lmBg: '#e3f4ea', brand: '#2f6bd8',
};
const fmt = (n, d = 0) => (n == null || Number.isNaN(n) ? '–' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dateText = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/**
 * Generic table drawing. columns: [{ key, label, width, align: 'left'|'right', group?: 'IC'|'LM' }]
 * rows: [{ cells: {key: text}, strong?: bool, tone?: 'total'|'selected' }]
 */
function tableSvg({ title, subtitle, columns, rows, pixelRatio = 2 }) {
  const pad = 20, rowH = 34, headH = 30, groupH = 28, titleH = 66;
  const width = pad * 2 + columns.reduce((a, c) => a + c.width, 0);
  const height = titleH + groupH + headH + rows.length * rowH + pad;
  const parts = [];
  parts.push(`<rect width="${width}" height="${height}" fill="${C.bg}"/>`);
  parts.push(`<rect x="${pad - 2}" y="20" width="4" height="20" rx="2" fill="${C.brand}"/>`);
  parts.push(`<text x="${pad + 10}" y="35" font-family="${FONT}" font-size="17" font-weight="700" fill="${C.ink}">${esc(title)}</text>`);
  parts.push(`<text x="${pad + 10}" y="54" font-family="${FONT}" font-size="12" fill="${C.muted}">${esc(subtitle)}</text>`);
  // grouped header (IC / LM bands)
  let x = pad;
  const groups = [];
  for (const c of columns) {
    const last = groups[groups.length - 1];
    if (c.group && last && last.group === c.group) last.width += c.width; else groups.push({ group: c.group, x, width: c.width });
    x += c.width;
  }
  const gy = titleH;
  for (const g of groups) {
    if (!g.group) continue;
    const fill = g.group === 'IC' ? C.icBg : C.lmBg, ink = g.group === 'IC' ? C.ic : C.lm;
    const label = g.group === 'IC' ? 'IC · INTERESTED COURSE' : 'LM · LEAD MASTER';
    parts.push(`<rect x="${g.x + 2}" y="${gy}" width="${g.width - 4}" height="${groupH - 4}" rx="6" fill="${fill}"/>`);
    parts.push(`<text x="${g.x + g.width / 2}" y="${gy + 17}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="700" letter-spacing="0.6" fill="${ink}">${label}</text>`);
  }
  // column header
  const hy = gy + groupH;
  parts.push(`<rect x="${pad}" y="${hy}" width="${width - pad * 2}" height="${headH}" fill="${C.head}"/>`);
  x = pad;
  for (const c of columns) {
    const tx = c.align === 'right' ? x + c.width - 8 : x + 8;
    parts.push(`<text x="${tx}" y="${hy + 19}" text-anchor="${c.align === 'right' ? 'end' : 'start'}" font-family="${FONT}" font-size="11" font-weight="600" letter-spacing="0.5" fill="${C.muted}">${esc(c.label.toUpperCase())}</text>`);
    x += c.width;
  }
  // rows
  let y = hy + headH;
  rows.forEach((r) => {
    const fill = r.tone === 'total' ? C.total : r.tone === 'selected' ? C.selected : C.card;
    parts.push(`<rect x="${pad}" y="${y}" width="${width - pad * 2}" height="${rowH}" fill="${fill}"/>`);
    parts.push(`<line x1="${pad}" y1="${y + rowH}" x2="${width - pad}" y2="${y + rowH}" stroke="${C.line}" stroke-width="1"/>`);
    x = pad;
    for (const c of columns) {
      const tx = c.align === 'right' ? x + c.width - 8 : x + 8;
      const weight = r.strong || c.strong ? 700 : 400;
      parts.push(`<text x="${tx}" y="${y + 22}" text-anchor="${c.align === 'right' ? 'end' : 'start'}" font-family="${FONT}" font-size="13" font-weight="${weight}" fill="${C.ink}">${esc(r.cells[c.key] ?? '')}</text>`);
      x += c.width;
    }
    y += rowH;
  });
  parts.push(`<rect x="${pad}" y="${hy}" width="${width - pad * 2}" height="${y - hy}" fill="none" stroke="${C.line}" stroke-width="1"/>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`;
  return { svg, width, height, pixelRatio };
}

function toPng({ svg, width, pixelRatio }) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: Math.round(width * pixelRatio) }, font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' } });
  return Buffer.from(r.render().asPng());
}

/** "By BDM team" table: every team with people, totals on top. */
export function teamsTablePng(digest, opts = {}) {
  const teams = digest.teams.filter((t) => t.bdes > 0).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  const sum = (k) => teams.reduce((a, t) => a + t[k], 0);
  const bdes = sum('bdes');
  const columns = [
    { key: 'team', label: 'Team', width: 190, align: 'left', strong: true },
    { key: 'bdes', label: 'BDEs', width: 60, align: 'right' },
    { key: 'icToday', label: 'Today', width: 80, align: 'right', group: 'IC' },
    { key: 'icOverdue', label: 'Till yesterday', width: 100, align: 'right', group: 'IC' },
    { key: 'lmToday', label: 'Today', width: 80, align: 'right', group: 'LM' },
    { key: 'lmOverdue', label: 'Till yesterday', width: 100, align: 'right', group: 'LM' },
    { key: 'total', label: 'Total', width: 80, align: 'right', strong: true },
    { key: 'perBde', label: 'Per BDE', width: 76, align: 'right' },
  ];
  const cell = (t, n) => ({ team: t, bdes: fmt(n.bdes), icToday: fmt(n.icToday), icOverdue: fmt(n.icOverdue), lmToday: fmt(n.lmToday), lmOverdue: fmt(n.lmOverdue), total: fmt(n.total), perBde: n.bdes ? fmt(n.total / n.bdes, 1) : '–' });
  const rows = [
    { cells: cell('Total', { bdes, icToday: sum('icToday'), icOverdue: sum('icOverdue'), lmToday: sum('lmToday'), lmOverdue: sum('lmOverdue'), total: sum('total') }), strong: true, tone: 'total' },
    ...teams.map((t) => ({ cells: cell(clip(t.label, 24), t), tone: opts.highlight && t.team === opts.highlight ? 'selected' : undefined })),
  ];
  return toPng(tableSvg({ title: 'Pending tasks by BDM team', subtitle: `Pending tasks per team · ${dateText(digest.date)}`, columns, rows }));
}

/** "By executive" table for one team: totals on top, executives by total pending. */
export function executivesTablePng(team, digest) {
  const owners = [...(team.owners || team.top || [])].sort((a, b) => b.total - a.total || b.overdue - a.overdue || a.owner.localeCompare(b.owner));
  const sum = (k) => owners.reduce((a, o) => a + o[k], 0);
  const columns = [
    { key: 'owner', label: 'Executive', width: 230, align: 'left', strong: true },
    { key: 'icToday', label: 'Today', width: 80, align: 'right', group: 'IC' },
    { key: 'icOverdue', label: 'Till yesterday', width: 100, align: 'right', group: 'IC' },
    { key: 'lmToday', label: 'Today', width: 80, align: 'right', group: 'LM' },
    { key: 'lmOverdue', label: 'Till yesterday', width: 100, align: 'right', group: 'LM' },
    { key: 'total', label: 'Total', width: 80, align: 'right', strong: true },
  ];
  const cell = (name, n) => ({ owner: name, icToday: fmt(n.icToday), icOverdue: fmt(n.icOverdue), lmToday: fmt(n.lmToday), lmOverdue: fmt(n.lmOverdue), total: fmt(n.total) });
  const rows = [
    { cells: cell('Total', { icToday: sum('icToday'), icOverdue: sum('icOverdue'), lmToday: sum('lmToday'), lmOverdue: sum('lmOverdue'), total: sum('total') }), strong: true, tone: 'total' },
    ...owners.map((o) => ({ cells: cell(clip(o.owner, 30), o) })),
  ];
  return toPng(tableSvg({ title: `${team.label} · pending tasks by executive`, subtitle: `${owners.length} executives with tasks · ${dateText(digest.date)}`, columns, rows }));
}

/** The picture for one planned message: all teams for "*", the team's executives otherwise. */
export function messagePng(msg, digest) {
  if (msg.team === '*') return teamsTablePng(digest);
  const team = digest.teams.find((t) => t.team === msg.team);
  return team ? executivesTablePng(team, digest) : null;
}
