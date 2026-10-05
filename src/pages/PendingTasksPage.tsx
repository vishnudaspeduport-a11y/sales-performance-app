import { FileText, Image as ImageIcon, Images, MessageCircle, Send, Settings2, Share2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { KPIGrid, type KPI } from '../components/KPICard';
import { Card } from '../components/ui/Card';
import { TooltipFrame } from '../components/ui/ChartTooltip';
import { Button, SearchInput, Segmented, Select } from '../components/ui/Controls';
import { EmptyState } from '../components/ui/States';
import { formatDate, formatTimestampIST } from '../lib/dates';
import { formatNumber } from '../lib/format';
import { ALL_SUBJECTS, aggregateOwners, aggregateTeams, filterRows, historySeries, overdueOf, sumTotals, teamLabel, todayOf, type CountRule, type PendingOwnerRow, type PendingTotals } from '../lib/pending';
import { allTeamsReportText, shareOnWhatsApp, teamReportText } from '../lib/whatsapp';
import { whatsappSetup } from '../lib/api';
import { captureElementPng, captureManyPng, copyToClipboard, download, isMobileDevice as isMobile, openWhatsApp, shareElementAsImage } from '../lib/shareImage';
import { ALL_REPORTS_KEY, ALL_TEAMS_KEY, openTarget, targetFor, type WhatsAppTarget } from '../lib/whatsappTargets';
import { WhatsAppAllTeamsDialog, type TeamPicture } from '../components/WhatsAppAllTeamsDialog';
import { picturesToPdf } from '../lib/pdf';
import { WhatsAppTargetsDialog } from '../components/WhatsAppTargetsDialog';
import { WhatsAppSendDialog, type WhatsAppSendMeta } from '../components/WhatsAppSendDialog';
import { useTheme } from '../state/ThemeContext';
import { useView } from '../state/ViewContext';
import type { PendingSnapshot } from '../types';

const COLS: { key: keyof PendingTotals; label: string; group: 'IC' | 'LM' | 'Total' }[] = [
  { key: 'icToday', label: 'Today', group: 'IC' },
  { key: 'icOverdue', label: 'Till Yesterday', group: 'IC' },
  { key: 'lmToday', label: 'Today', group: 'LM' },
  { key: 'lmOverdue', label: 'Till Yesterday', group: 'LM' },
  { key: 'total', label: 'Total', group: 'Total' },
];

function Cell({ n, strong = false }: { n: number | null; strong?: boolean }) {
  return <td className={`tabular px-3 py-1.5 text-right ${strong ? 'font-semibold text-ink dark:text-ink-dark' : n === 0 ? 'text-ink-muted' : ''}`}>{n == null ? '–' : formatNumber(n, Number.isInteger(n) ? 0 : 1)}</td>;
}

function GroupHeader({ extra }: { extra?: string[] }) {
  return (
    <>
      <tr className="text-center text-[11px] uppercase tracking-wide text-ink-muted">
        <th />
        {extra?.map((e) => <th key={e} />)}
        <th colSpan={2} className="border-b-2 border-[#2a78d6] bg-[#2a78d6]/10 px-3 py-1 font-semibold text-[#184f95] dark:border-[#4a92e8] dark:bg-[#4a92e8]/20 dark:text-[#9ec5f4]">IC · Interested Course</th>
        <th colSpan={2} className="border-b-2 border-[#1baf7a] bg-[#1baf7a]/10 px-3 py-1 font-semibold text-[#0b6b48] dark:border-[#34c48e] dark:bg-[#34c48e]/20 dark:text-[#7fd3b0]">LM · Lead Master</th>
        <th />
      </tr>
    </>
  );
}

const canShareFile = (file: File) => { try { const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean; share?: unknown }; return !!nav.canShare && !!nav.share && nav.canShare({ files: [file] }); } catch { return false; } };

/** The executive rows of one team (or of a search across teams). */
function ExecTable({ owners, total, withTeam, sticky, empty }: { owners: PendingOwnerRow[]; total: PendingTotals; withTeam: boolean; sticky: boolean; empty: string }) {
  return (
    <table className="zebra w-full min-w-[560px] text-sm">
      <thead className={`${sticky ? 'sticky top-0 ' : ''}bg-surface dark:bg-surface-dark`}>
        <GroupHeader extra={withTeam ? ['team'] : undefined} />
        <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted dark:border-line-dark">
          <th className="px-3 py-2 font-medium">Executive</th>
          {withTeam && <th className="px-3 py-2 font-medium">Team</th>}
          {COLS.map((c) => <th key={c.key} className="px-3 py-2 text-right font-medium">{c.label}</th>)}
        </tr>
      </thead>
      <tbody>
        <tr className="border-b border-line bg-accent-soft/50 font-semibold dark:border-line-dark dark:bg-accent-soft-dark/30">
          <td className="px-3 py-1.5 text-ink dark:text-ink-dark">Total</td>
          {withTeam && <td />}
          {COLS.map((c) => <Cell key={c.key} n={total[c.key]} strong />)}
        </tr>
        {owners.map((o) => (
          <tr key={`${o.team}|${o.owner}`} className="border-b border-line last:border-0 dark:border-line-dark">
            <td className="px-3 py-1.5 text-ink dark:text-ink-dark">{o.owner}</td>
            {withTeam && <td className="px-3 py-1.5 text-ink-secondary dark:text-ink-dark-secondary">{teamLabel(o.team)}</td>}
            {COLS.map((c) => <Cell key={c.key} n={o[c.key]} strong={c.key === 'total'} />)}
          </tr>
        ))}
        {owners.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-ink-muted">{empty}</td></tr>}
      </tbody>
    </table>
  );
}

export function PendingTasksPage({ pending }: { pending: PendingSnapshot | null }) {
  const { chart, theme } = useTheme();
  const { view } = useView();
  const [subject, setSubject] = useState<string>(ALL_SUBJECTS);
  const [rule, setRule] = useState<CountRule>('owner');
  const [team, setTeam] = useState<string>('');
  const [query, setQuery] = useState('');
  const teamCard = useRef<HTMLDivElement>(null);
  const execCard = useRef<HTMLDivElement>(null);
  // "Send image on WhatsApp": a PNG of the card. When a WhatsApp chat is set for the team (gear button)
  // the picture is copied and that chat opened, ready for a paste; otherwise the share sheet opens
  // (pick WhatsApp and the chats there) or, failing that, the picture is copied and WhatsApp Web opened.
  const [imageNote, setImageNote] = useState<{ card: 'team' | 'exec'; text: string; whatsapp?: boolean; target?: WhatsAppTarget; separate?: boolean; file?: File } | null>(null);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const shareImage = async (card: 'team' | 'exec', ref: RefObject<HTMLDivElement>, name: string, title: string, teamKey: string) => {
    if (!ref.current) return;
    setImageNote({ card, text: 'Preparing image…' });
    let note: typeof imageNote = null;
    try {
      const target = targetFor(teamKey);
      if (target && await copyToClipboard(await captureElementPng(ref.current, theme === 'dark'))) {
        const opened = openTarget(target);
        const paste = isMobile() ? 'press and hold the message box, Paste' : 'press Ctrl+V';
        note = { card, text: opened ? `Image copied and the ${target.kind === 'group' ? 'group' : 'chat'} is opening: ${paste}, then send.` : `Image copied. Open the ${target.kind === 'group' ? 'group' : 'chat'}, ${paste}, then send.`, target };
        setImageNote(note);
        setTimeout(() => setImageNote((n) => (n === note ? null : n)), 30000);
        return;
      }
      const r = await shareElementAsImage(ref.current, name, title, theme === 'dark');
      if (r === 'copied') { openWhatsApp(); note = { card, text: 'Image copied. In WhatsApp pick the chat, press Ctrl+V to paste it, then send.', whatsapp: true }; }
      else if (r === 'shared') note = { card, text: 'Handed to WhatsApp.' };
      else if (r === 'downloaded') note = { card, text: `Image saved as ${name}. Attach it in WhatsApp.` };
      else if (r === 'blocked') note = { card, text: 'Could not copy or save the image in this window.' };
    } catch { note = { card, text: 'Could not create the image.' }; }
    setImageNote(note);
    if (note) setTimeout(() => setImageNote((n) => (n === note ? null : n)), note.whatsapp ? 30000 : 6000);
  };
  // "Send to numbers" (admin): the picture goes to chosen WhatsApp numbers through the server.
  const [sendDialog, setSendDialog] = useState<{ image: Blob; meta: WhatsAppSendMeta; teamKey: string } | null>(null);
  const [apiSend, setApiSend] = useState(false);
  useEffect(() => {
    if (view !== 'admin') { setApiSend(false); return; }
    let alive = true;
    whatsappSetup().then((s) => { if (alive) setApiSend(s.configured && s.recipients.length > 0); }).catch(() => { if (alive) setApiSend(false); });
    return () => { alive = false; };
  }, [view]);
  const openSend = async (card: 'team' | 'exec', ref: RefObject<HTMLDivElement>, teamKey: string, label: string, totals: PendingTotals) => {
    if (!ref.current || !pending) return;
    setImageNote({ card, text: 'Preparing image…' });
    try {
      const image = await captureElementPng(ref.current, theme === 'dark');
      setImageNote(null);
      setSendDialog({ image, teamKey, meta: { team: label, date: formatDate(pending.date), overdue: formatNumber(overdueOf(totals)), today: formatNumber(todayOf(totals)) } });
    } catch { setImageNote({ card, text: 'Could not create the image.' }); }
  };
  const ImageNote = ({ card }: { card: 'team' | 'exec' }) => imageNote?.card === card ? (
    <span className="flex items-center gap-2 text-xs text-ink-muted">
      <span>{imageNote.text}</span>
      {imageNote.target && <Button size="sm" onClick={() => { const t = imageNote.target; if (t) openTarget(t); }} title="Open the chat in a new tab"><MessageCircle className="h-3.5 w-3.5 text-[#25d366]" /> Open chat</Button>}
      {imageNote.whatsapp && <Button size="sm" onClick={openWhatsApp} title="Open WhatsApp Web in a new tab"><MessageCircle className="h-3.5 w-3.5 text-[#25d366]" /> Open WhatsApp</Button>}
      {imageNote.file && canShareFile(imageNote.file) && <Button size="sm" onClick={() => { const file = imageNote.file; if (file) void (navigator as Navigator & { share?: (d: ShareData) => Promise<void> }).share?.({ files: [file], title: file.name }).catch(() => undefined); }} title="Hand the PDF to the share sheet: pick WhatsApp, then the chat"><Share2 className="h-3.5 w-3.5" /> Share PDF</Button>}
      {imageNote.separate && <Button size="sm" variant="ghost" onClick={() => { setImageNote(null); setBulk({ stage: 'preparing', done: 0 }); }} title="One picture per team instead of one picture with every team"><Images className="h-3.5 w-3.5" /> Separate pictures</Button>}
    </span>
  ) : null;

  // "Send all teams": every team's executive table in ONE picture, copied at once, so a single paste
  // in the chosen chat sends them all (the clipboard holds one picture, never several). The tables are
  // drawn off screen. "Separate pictures" makes one picture per team and offers them in a dialog.
  const [bulk, setBulk] = useState<{ stage: 'combined' } | { stage: 'preparing'; done: number; pdf?: boolean } | { stage: 'ready'; items: TeamPicture[] } | null>(null);
  const bulkRefs = useRef(new Map<string, HTMLDivElement>());
  const combinedRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => (pending ? filterRows(pending, subject, rule) : []), [pending, subject, rule]);
  // The executive list follows the sheet's per-executive block: every task of the executive,
  // resigned executives left out, whatever the team switch says. With a search term it spans every team.
  const execRows = useMemo(() => (pending ? filterRows(pending, subject, 'exec') : []), [pending, subject]);
  const teams = useMemo(() => aggregateTeams(rows), [rows]);
  const grand = useMemo(() => sumTotals(teams), [teams]);
  const selectedTeam = team && (teams.some((t) => t.team === team) || execRows.some((r) => r.team === team)) ? team : (teams[0]?.team ?? execRows[0]?.team ?? '');
  const q = query.trim().toLowerCase();
  const owners = useMemo(() => (q ? aggregateOwners(execRows, null).filter((o) => o.owner.toLowerCase().includes(q)) : aggregateOwners(execRows, selectedTeam)), [execRows, selectedTeam, q]);
  const ownersTotal = useMemo(() => sumTotals(owners), [owners]);
  const trend = useMemo(() => (pending ? historySeries(pending.history, null, rule) : []), [pending, rule]);
  const teamKeys = useMemo(() => [...new Set([...teams.map((t) => t.team), ...aggregateTeams(execRows).map((t) => t.team)])].sort((a, b) => teamLabel(a).localeCompare(teamLabel(b))), [teams, execRows]);
  const bulkTeams = useMemo(() => teamKeys.map((t) => { const list = aggregateOwners(execRows, t); return { team: t, label: teamLabel(t), owners: list, total: sumTotals(list) }; }).filter((t) => t.owners.length > 0), [teamKeys, execRows]);
  const preparing = bulk?.stage === 'preparing';
  const combining = bulk?.stage === 'combined';
  useEffect(() => {
    if (!combining || !pending) return;
    let alive = true;
    (async () => {
      await new Promise<void>((resolve) => { const t = setTimeout(resolve, 300); requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(t); resolve(); })); });
      let note: typeof imageNote = null;
      try {
        if (!combinedRef.current) throw new Error('not drawn');
        const blob = await captureElementPng(combinedRef.current);
        if (!alive) return;
        const paste = isMobile() ? 'press and hold the message box, Paste' : 'press Ctrl+V';
        if (await copyToClipboard(blob)) {
          const target = targetFor(ALL_REPORTS_KEY);
          if (target) {
            const opened = openTarget(target);
            note = { card: 'exec', text: `All ${bulkTeams.length} teams copied as one picture${opened ? ` and the ${target.kind === 'group' ? 'group' : 'chat'} is opening` : ''}: ${paste}, then send.`, target, separate: true };
          } else {
            const w = window.open(isMobile() ? 'https://wa.me/' : 'https://web.whatsapp.com/', '_blank', 'noopener');
            note = { card: 'exec', text: `All ${bulkTeams.length} teams copied as one picture${w ? ' and WhatsApp is opening' : ''}: pick the chat, ${paste}, then send.`, whatsapp: true, separate: true };
          }
        } else {
          const name = `pending-all-teams-${pending.date}.png`;
          download(blob, name);
          note = { card: 'exec', text: `This browser could not copy the picture, so it was saved as ${name}. Attach it in WhatsApp.`, whatsapp: true, separate: true };
        }
      } catch { note = { card: 'exec', text: 'Could not create the picture.' }; }
      if (!alive) return;
      setBulk(null);
      setImageNote(note);
      setTimeout(() => setImageNote((n) => (n === note ? null : n)), 45000);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combining]);
  useEffect(() => {
    if (!preparing || !pending) return;
    let alive = true;
    (async () => {
      // one frame for the off-screen tables to be laid out
      await new Promise<void>((resolve) => { const t = setTimeout(resolve, 300); requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(t); resolve(); })); });
      const list = bulkTeams.filter((t) => bulkRefs.current.get(t.team));
      const asPdf = bulk?.stage === 'preparing' && !!bulk.pdf;
      try {
        const blobs = await captureManyPng(list.map((t) => bulkRefs.current.get(t.team) as HTMLDivElement), (done) => { if (alive) setBulk((b) => (b?.stage === 'preparing' ? { ...b, done } : b)); });
        if (!alive) return;
        if (asPdf) {
          // Every team one below another, on A4 pages. A PDF cannot be pasted into a chat, so it is saved to be attached.
          const { pdf, pages } = await picturesToPdf(blobs, `Pending tasks - all teams - ${formatDate(pending.date)}${subject === ALL_SUBJECTS ? '' : ` - ${subject}`}`);
          if (!alive) return;
          const name = `pending-all-teams-${pending.date}.pdf`;
          download(pdf, name);
          const target = targetFor(ALL_REPORTS_KEY);
          const note: typeof imageNote = { card: 'exec', text: `PDF saved as ${name} (${list.length} teams, ${pages} pages). In WhatsApp press attach, choose Document and pick it.`, file: new File([pdf], name, { type: 'application/pdf' }), ...(target ? { target } : { whatsapp: true }) };
          setBulk(null);
          setImageNote(note);
          setTimeout(() => setImageNote((n) => (n === note ? null : n)), 60000);
          return;
        }
        setBulk({ stage: 'ready', items: list.map((t, i) => ({ team: t.team, label: t.label, blob: blobs[i], filename: `pending-${pending.date}-${String(i + 1).padStart(2, '0')}-${t.label.replace(/\s+/g, '-').toLowerCase()}.png` })) });
      } catch {
        if (alive) { setBulk(null); setImageNote({ card: 'exec', text: asPdf ? 'Could not create the PDF.' : 'Could not create the pictures.' }); }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preparing]);

  if (!pending) {
    return <EmptyState title="Pending tasks are not available yet" message="The Pending Tasks (Sales Overdue) sheet has not been read by the sync. Check that the sheet is shared with the service account and press Refresh Data." />;
  }

  const bdes = teams.reduce((s, t) => s + t.bdes, 0);
  // "Send on WhatsApp": opens the user's own WhatsApp with the report typed out; they pick the chat.
  const shareTeam = (teamKey: string) => { const t = teams.find((x) => x.team === teamKey); if (t) shareOnWhatsApp(teamReportText(t, aggregateOwners(execRows, teamKey), pending.date)); };
  const shareAll = () => shareOnWhatsApp(allTeamsReportText(teams, pending.date));
  const kpis: KPI[] = [
    { key: 'icToday', tone: 'blue', label: 'IC Due Today', value: formatNumber(grand.icToday), sub: 'Interested Course tasks due today', description: 'Interested Course tasks whose due date is today, assigned to the lead owner, owner not resigned.' },
    { key: 'icOverdue', tone: 'teal', label: 'IC Till Yesterday', value: formatNumber(grand.icOverdue), sub: 'overdue Interested Course tasks', description: 'Interested Course tasks whose due date has passed.' },
    { key: 'lmToday', tone: 'green', label: 'LM Due Today', value: formatNumber(grand.lmToday), sub: 'Lead Master tasks due today', description: 'Lead Master tasks whose due date is today.' },
    { key: 'lmOverdue', tone: 'amber', label: 'LM Till Yesterday', value: formatNumber(grand.lmOverdue), sub: 'overdue Lead Master tasks', description: 'Lead Master tasks whose due date has passed.' },
    { key: 'total', tone: 'red', label: 'Total Pending', value: formatNumber(grand.total), sub: `${formatNumber(grand.icToday + grand.lmToday)} today · ${formatNumber(grand.icOverdue + grand.lmOverdue)} overdue`, description: 'All four figures added up.' },
    { key: 'bdes', tone: 'violet', label: 'Executives With Tasks', value: formatNumber(bdes), sub: bdes ? `${formatNumber(grand.total / bdes, 1)} tasks each on average` : undefined, description: 'Executives who have at least one pending task in the selected subject.' },
  ];

  const subjectOptions = [{ value: ALL_SUBJECTS, label: 'All subjects' }, ...pending.subjects.map((s) => ({ value: s, label: s }))];
  const colors = theme === 'dark' ? ['#3987e5', '#8fbcf0', '#199e70', '#7fd3b0'] : ['#2a78d6', '#9cc3ee', '#1baf7a', '#8fd9b8'];
  const chartData = teams.map((t) => ({ name: t.label, icToday: t.icToday, icOverdue: t.icOverdue, lmToday: t.lmToday, lmOverdue: t.lmOverdue, total: t.total }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-transparent bg-surface px-4 py-3 shadow-card dark:border-line-dark dark:bg-surface-dark">
        <div className="text-xs text-ink-secondary dark:text-ink-dark-secondary">
          <span className="font-medium text-ink dark:text-ink-dark">{pending.origin === 'salesforce' ? 'Pending tasks from Salesforce' : 'Pending Tasks (Sales Overdue) sheet'}</span> · open IC and LM tasks due up to <span className="font-medium text-ink dark:text-ink-dark">{formatDate(pending.date)}</span>{pending.asOf ? <> · read {formatTimestampIST(pending.asOf)}</> : null}{pending.origin === 'salesforce' ? ' · same filters as the "Till Today IC / LM Tasks-MIS" reports' : null}
          <div className="mt-0.5 text-ink-muted">{rule === 'all' ? 'Every open task, by the owner\'s team.' : `Only tasks assigned to the lead\'s owner whose owner has not resigned${pending.origin === 'salesforce' ? ' (resigned per icku; assignment compared by user id)' : ', the rule used by some rows of the sheet\'s DB tab'}.`}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented ariaLabel="Counting rule" value={rule} onChange={setRule} options={[{ value: 'owner', label: 'Assigned to owner only' }, { value: 'all', label: 'All tasks in the tab' }]} />
          <Segmented ariaLabel="Subject" value={subject} onChange={setSubject} options={subjectOptions} />
          <Button size="sm" onClick={shareAll} title="Open WhatsApp with the all-teams report ready to send"><MessageCircle className="h-3.5 w-3.5 text-[#25d366]" /> Send all teams on WhatsApp</Button>
        </div>
      </div>

      <section aria-label="Pending overview">
        <div className="mb-2 flex items-baseline justify-between"><h2 className="flex items-center gap-2 text-sm font-semibold text-ink dark:text-ink-dark"><span aria-hidden className="h-3.5 w-1 rounded-full bg-accent dark:bg-accent-dark" />Overview</h2><span className="text-xs text-ink-muted">{subject === ALL_SUBJECTS ? 'all subjects' : subject}</span></div>
        <KPIGrid kpis={kpis} />
      </section>

      {/* The tables take the full width; the charts sit in one row below them. */}
      <div ref={teamCard} className="min-w-0">
      <Card title="By BDM team" subtitle={`Pending tasks per team · ${formatDate(pending.date)} · click a team to see its executives`} actions={<span data-no-capture className="flex flex-wrap items-center gap-2"><ImageNote card="team" /><Button size="sm" onClick={() => void shareImage('team', teamCard, `pending-tasks-${pending.date}.png`, `Pending tasks · ${formatDate(pending.date)}`, ALL_TEAMS_KEY)} title="Picture of this table for WhatsApp: share sheet on a phone, copied for pasting (Ctrl+V) on a computer"><ImageIcon className="h-3.5 w-3.5" /> Send image on WhatsApp</Button>{apiSend && <Button size="sm" onClick={() => void openSend('team', teamCard, '*', 'All teams', grand)} title="Post this table straight to chosen WhatsApp numbers"><Send className="h-3.5 w-3.5 text-[#25d366]" /> Send to numbers</Button>}</span>} bodyClassName="!px-0 !py-0">
        <div className="overflow-x-auto">
          <table className="zebra w-full min-w-[640px] text-sm">
            <thead className="bg-surface dark:bg-surface-dark">
              <GroupHeader extra={['bdes']} />
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted dark:border-line-dark">
                <th className="px-3 py-2 font-medium">Team</th>
                <th className="px-3 py-2 text-right font-medium" title="Executives with at least one pending task">BDEs</th>
                {COLS.map((c) => <th key={c.key} className="px-3 py-2 text-right font-medium">{c.label}</th>)}
                <th className="px-3 py-2 text-right font-medium" title="Total pending divided by executives with tasks">Per BDE</th>
                <th data-no-capture className="px-2 py-2 text-center font-medium" title="Send this team's report on WhatsApp">Send</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-line bg-accent-soft/50 font-semibold dark:border-line-dark dark:bg-accent-soft-dark/30">
                <td className="px-3 py-1.5 text-ink dark:text-ink-dark">Total</td>
                <Cell n={bdes} strong />
                {COLS.map((c) => <Cell key={c.key} n={grand[c.key]} strong />)}
                <Cell n={bdes ? Math.round(grand.total / bdes) : null} strong />
                <td data-no-capture className="px-2 py-1 text-center"><button type="button" onClick={(e) => { e.stopPropagation(); shareAll(); }} title="Send the all-teams report on WhatsApp" aria-label="Send the all-teams report on WhatsApp" className="rounded-md p-1 text-[#25d366] hover:bg-plane dark:hover:bg-plane-dark"><MessageCircle className="h-4 w-4" /></button></td>
              </tr>
              {teams.map((t) => (
                <tr key={t.team} onClick={() => setTeam(t.team)} className={`cursor-pointer border-b border-line last:border-0 hover:bg-plane dark:border-line-dark dark:hover:bg-plane-dark ${t.team === selectedTeam ? 'bg-accent-soft/60 dark:bg-accent-soft-dark/40' : ''}`}>
                  <td className="px-3 py-1.5 font-medium text-ink dark:text-ink-dark" title={t.team}><span className="inline-flex items-center gap-2"><span aria-hidden className={`h-2 w-2 rounded-full ${t.team === selectedTeam ? 'bg-accent dark:bg-accent-dark' : 'bg-line dark:bg-line-dark'}`} />{t.label}</span></td>
                  <Cell n={t.bdes} />
                  {COLS.map((c) => <Cell key={c.key} n={t[c.key]} strong={c.key === 'total'} />)}
                  <Cell n={t.perBde == null ? null : Math.round(t.perBde)} />
                  <td data-no-capture className="px-2 py-1 text-center"><button type="button" onClick={(e) => { e.stopPropagation(); shareTeam(t.team); }} title={`Send ${t.label}'s report on WhatsApp`} aria-label={`Send ${t.label}'s report on WhatsApp`} className="rounded-md p-1 text-[#25d366] hover:bg-plane dark:hover:bg-plane-dark"><MessageCircle className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      </div>

      <div ref={execCard} className="min-w-0">
      <Card
        title="By executive"
        subtitle={`${q ? `${formatNumber(owners.length)} executives matching "${query.trim()}" across all teams` : selectedTeam ? `${teamLabel(selectedTeam)} · ${formatNumber(owners.length)} executives with pending tasks` : 'Pick a team'} · every task of the executive, resigned executives left out, as in the sheet's per-executive block`}
        actions={<span data-no-capture className="flex flex-wrap items-center gap-2"><ImageNote card="exec" /><Button size="sm" variant="ghost" onClick={() => setTargetsOpen(true)} title="Choose the WhatsApp group or number for each team" aria-label="WhatsApp chats for each team"><Settings2 className="h-3.5 w-3.5" /> WhatsApp chats</Button>{selectedTeam && <Button size="sm" onClick={() => void shareImage('exec', execCard, `pending-${teamLabel(selectedTeam).replace(/\s+/g, '-').toLowerCase()}-${pending.date}.png`, `${teamLabel(selectedTeam)} · pending tasks`, selectedTeam)} title="Picture of this table for WhatsApp: share sheet on a phone, copied for pasting (Ctrl+V) on a computer"><ImageIcon className="h-3.5 w-3.5" /> Send image on WhatsApp</Button>}{bulkTeams.length > 1 && <Button size="sm" onClick={() => { setImageNote({ card: 'exec', text: 'Preparing every team…' }); setBulk({ stage: 'combined' }); }} disabled={preparing || combining} title="Every team's table in one picture, copied at once: pick the chat in WhatsApp and paste"><Images className="h-3.5 w-3.5" /> {combining ? 'Preparing…' : preparing && !bulk.pdf ? `Preparing ${bulk.done} of ${bulkTeams.length}…` : 'Send all teams'}</Button>}{bulkTeams.length > 1 && <Button size="sm" onClick={() => { setImageNote({ card: 'exec', text: 'Preparing the PDF…' }); setBulk({ stage: 'preparing', done: 0, pdf: true }); }} disabled={preparing || combining} title="Every team's table in one PDF, one below another, saved to attach in WhatsApp"><FileText className="h-3.5 w-3.5" /> {preparing && bulk.pdf ? `PDF ${bulk.done} of ${bulkTeams.length}…` : 'All teams PDF'}</Button>}{selectedTeam && apiSend && <Button size="sm" onClick={() => void openSend('exec', execCard, selectedTeam, teamLabel(selectedTeam), ownersTotal)} title="Post this table straight to chosen WhatsApp numbers"><Send className="h-3.5 w-3.5 text-[#25d366]" /> Send to numbers</Button>}{selectedTeam && !q && <Button size="sm" onClick={() => shareTeam(selectedTeam)} title={`Open WhatsApp with ${teamLabel(selectedTeam)}'s report ready to send`}><MessageCircle className="h-3.5 w-3.5 text-[#25d366]" /> Send on WhatsApp</Button>}<SearchInput value={query} onChange={setQuery} placeholder="Search executive…" className="w-48" /><Select ariaLabel="Team" value={selectedTeam} onChange={(v) => { setTeam(v); setQuery(''); }} options={teamKeys.map((t) => ({ value: t, label: teamLabel(t) }))} /></span>}
        bodyClassName="!px-0 !py-0"
      >
        <div className="max-h-[32rem] overflow-auto scroll-thin">
          <ExecTable owners={owners} total={ownersTotal} withTeam={!!q} sticky empty={q ? 'No executive with pending tasks matches that name.' : 'No pending tasks for this team and subject.'} />
        </div>
      </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Pending by team" subtitle="Due today vs till yesterday, stacked">
          <div style={{ height: Math.max(220, chartData.length * 30 + 40) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barCategoryGap={6}>
                <CartesianGrid stroke={chart.grid} horizontal={false} />
                <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v: number) => formatNumber(v)} height={20} />
                <YAxis type="category" dataKey="name" width={120} tickLine={false} axisLine={false} tick={{ fill: chart.ink, fontSize: 11 }} interval={0} />
                <Tooltip cursor={{ fill: chart.grid, opacity: 0.4 }} content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as (typeof chartData)[number];
                  return <TooltipFrame title={d.name} rows={[{ label: 'IC today', value: formatNumber(d.icToday), color: colors[0] }, { label: 'IC till yesterday', value: formatNumber(d.icOverdue), color: colors[1] }, { label: 'LM today', value: formatNumber(d.lmToday), color: colors[2] }, { label: 'LM till yesterday', value: formatNumber(d.lmOverdue), color: colors[3] }]} footer={`${formatNumber(d.total)} pending`} />;
                }} />
                <Legend verticalAlign="top" height={28} iconType="circle" />
                <Bar dataKey="icToday" name="IC today" stackId="p" fill={colors[0]} maxBarSize={18} />
                <Bar dataKey="icOverdue" name="IC till yesterday" stackId="p" fill={colors[1]} maxBarSize={18} />
                <Bar dataKey="lmToday" name="LM today" stackId="p" fill={colors[2]} maxBarSize={18} />
                <Bar dataKey="lmOverdue" name="LM till yesterday" stackId="p" fill={colors[3]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Day over day" subtitle="Total pending tasks per snapshot day, all teams">
          {trend.length < 2 ? (
            <EmptyState title="Trend builds up from here" message={`One snapshot so far (${formatDate(trend[0]?.date ?? pending.date)}). Each day's sync adds a point.`} />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={chart.grid} vertical={false} />
                  <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: chart.axis }} tickFormatter={(d: string) => formatDate(d, false)} tick={{ fontSize: 11 }} />
                  <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => formatNumber(v)} />
                  <Tooltip content={({ active, payload, label }) => active && payload?.length ? <TooltipFrame title={formatDate(String(label))} rows={[{ label: 'Total pending', value: formatNumber(payload[0].value as number), color: chart.series[0] }, { label: 'Due today', value: formatNumber((payload[0].payload as { icToday: number; lmToday: number }).icToday + (payload[0].payload as { icToday: number; lmToday: number }).lmToday) }, { label: 'Overdue', value: formatNumber((payload[0].payload as { icOverdue: number; lmOverdue: number }).icOverdue + (payload[0].payload as { icOverdue: number; lmOverdue: number }).lmOverdue) }]} /> : null} />
                  <Line type="monotone" dataKey="total" name="Total pending" stroke={chart.series[0]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {pending.notes.length > 0 && (
        <div className="rounded-xl border border-line bg-surface px-4 py-3 text-xs text-ink-secondary dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark-secondary">
          <div className="mb-1 font-medium text-ink dark:text-ink-dark">{pending.origin === 'salesforce' ? 'How the tasks were read from Salesforce' : 'How the sheet was read'}</div>
          <ul className="list-disc space-y-0.5 pl-4">{pending.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
      )}

      {combining && (
        <div aria-hidden style={{ position: 'fixed', left: -20000, top: 0, pointerEvents: 'none' }}>
          <div ref={combinedRef} style={{ width: 2080 }} className="bg-surface p-4 dark:bg-surface-dark">
            <div className="mb-3 flex items-baseline justify-between gap-4 border-b border-line pb-2 dark:border-line-dark">
              <div className="text-lg font-semibold text-ink dark:text-ink-dark">Pending tasks · all teams · {formatDate(pending.date)}{subject === ALL_SUBJECTS ? '' : ` · ${subject}`}</div>
              <div className="text-sm text-ink-secondary dark:text-ink-dark-secondary">{formatNumber(bulkTeams.length)} teams · {formatNumber(bulkTeams.reduce((n, t) => n + t.owners.length, 0))} executives · {formatNumber(bulkTeams.reduce((n, t) => n + t.total.total, 0))} pending{pending.asOf ? ` · read ${formatTimestampIST(pending.asOf)}` : ''}</div>
            </div>
            <div style={{ columnCount: 4, columnGap: 14 }}>
              {bulkTeams.map((t) => (
                <div key={t.team} style={{ breakInside: 'avoid' }} className="mb-3.5 overflow-hidden rounded-lg border border-line dark:border-line-dark [&_table]:!min-w-0 [&_table]:!text-[13px] [&_td]:!px-2 [&_td]:!py-0.5 [&_th]:!px-2 [&_th]:!py-0.5">
                  <div className="flex items-baseline justify-between gap-2 border-b border-line bg-plane/60 px-2 py-1.5 dark:border-line-dark dark:bg-plane-dark/40">
                    <span className="text-sm font-semibold text-ink dark:text-ink-dark">{t.label}</span>
                    <span className="text-xs text-ink-muted">{formatNumber(t.owners.length)} executives</span>
                  </div>
                  <ExecTable owners={t.owners} total={t.total} withTeam={false} sticky={false} empty="" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {preparing && (
        <div aria-hidden style={{ position: 'fixed', left: -20000, top: 0, width: 900, pointerEvents: 'none' }}>
          {bulkTeams.map((t) => (
            <div key={t.team} ref={(el) => { if (el) bulkRefs.current.set(t.team, el); else bulkRefs.current.delete(t.team); }} className="mb-4">
              <Card title={`${t.label} · pending tasks`} subtitle={`${formatNumber(t.owners.length)} executives with pending tasks · ${formatDate(pending.date)}${subject === ALL_SUBJECTS ? '' : ` · ${subject}`}`} bodyClassName="!px-0 !py-0">
                <div className="overflow-x-auto"><ExecTable owners={t.owners} total={t.total} withTeam={false} sticky={false} empty="" /></div>
              </Card>
            </div>
          ))}
        </div>
      )}
      {bulk?.stage === 'ready' && <WhatsAppAllTeamsDialog items={bulk.items} target={targetFor(ALL_REPORTS_KEY)} title={`Pending tasks · ${formatDate(pending.date)}`} onChooseChat={() => { setBulk(null); setTargetsOpen(true); }} onClose={() => setBulk(null)} />}
      {sendDialog && <WhatsAppSendDialog image={sendDialog.image} meta={sendDialog.meta} teamKey={sendDialog.teamKey} onClose={() => setSendDialog(null)} />}
      {targetsOpen && <WhatsAppTargetsDialog teams={teamKeys.map((t) => ({ key: t, label: teamLabel(t) }))} onClose={() => setTargetsOpen(false)} />}
    </div>
  );
}
