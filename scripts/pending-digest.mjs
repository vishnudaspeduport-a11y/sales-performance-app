/**
 * Morning pending-tasks digest: one email (and/or WhatsApp message) per manager, plus an
 * all-teams summary for recipients with team "*". Runs from GitHub Actions (digest.yml).
 *
 *   node scripts/pending-digest.mjs [--dry-run] [--out digest-preview] [--payload file.json] [--target 5]
 *
 * Environment:
 *   DASHBOARD_URL       where the dashboard lives; its /api/data is read for the latest snapshot
 *                       (falls back to Supabase when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are set)
 *   DIGEST_RECIPIENTS   JSON list: [{"team":"Team Aswanth","email":"a@eduport.ai","whatsapp":"91XXXXXXXXXX"},{"team":"*","email":"head@eduport.ai"}]
 *   DIGEST_TARGET       overdue tasks per executive target (default 5)
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, DIGEST_FROM   for email (Gmail: smtp.gmail.com, 465, an app password)
 *   WHATSAPP_TOKEN, WHATSAPP_PHONE_ID                          WhatsApp Cloud API: permanent access token and the sender's phone number ID
 *   WHATSAPP_SEND                                              what goes on WhatsApp: image (default), text, or both
 *   WHATSAPP_IMAGE_TEMPLATE                                    approved template with an IMAGE header and four body parameters
 *                                                              (team, date, overdue, due today); default pending_tasks_image.
 *                                                              The picture is the dashboard table: all teams for "*", the team's
 *                                                              executives otherwise. Set to "none" to send a plain image message
 *                                                              (only delivered inside the 24-hour customer-service window).
 *   WHATSAPP_TEMPLATE, WHATSAPP_TEMPLATE_LANG                  text template (default pending_tasks_daily / en) with six body
 *                                                              parameters: team, date, overdue, due today, executives, top list.
 *                                                              Business-initiated WhatsApp messages must use a template; a plain text
 *                                                              message is only tried when WHATSAPP_TEMPLATE is set to "none".
 *
 * --dry-run renders every message to <out>/ as .html and .txt files and sends nothing.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDigest, planMessages } from '../server/digest.mjs';
import { messagePng } from '../server/digestImage.mjs';
import { arg, loadEnv } from './env.mjs';

loadEnv();
const dryRun = process.argv.includes('--dry-run');
const outDir = arg('--out', 'digest-preview');
const url = (process.env.DASHBOARD_URL || 'https://eduportsales.vishnudasp-eduport.workers.dev').replace(/\/+$/, '') + '/';
const target = Number(arg('--target', process.env.DIGEST_TARGET || 5)) || 5;

async function loadPending() {
  const file = arg('--payload', '');
  if (file) return JSON.parse(readFileSync(file, 'utf8')).pending;
  try {
    const res = await fetch(`${url}api/data?fresh=1`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    if (payload?.pending?.rows) return payload.pending;
    throw new Error('payload has no pending section');
  } catch (err) {
    console.warn(`Dashboard API not usable (${err.message}); trying Supabase.`);
    if (!process.env.SUPABASE_URL) throw err;
    const { createSupabaseRepo } = await import('../server/repo.mjs');
    const snap = await createSupabaseRepo().getLatestSnapshot();
    if (!snap?.payload?.pending?.rows) throw new Error('latest Supabase snapshot has no pending section');
    return snap.payload.pending;
  }
}

function recipients() {
  const raw = process.env.DIGEST_RECIPIENTS;
  if (!raw) return null;
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) throw new Error('DIGEST_RECIPIENTS must be a JSON array');
  return list;
}

async function sendEmail(msg) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, DIGEST_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) throw new Error('SMTP_HOST, SMTP_USER and SMTP_PASS are not set');
  const nodemailer = (await import('nodemailer')).default;
  const port = Number(SMTP_PORT || 465);
  const transport = nodemailer.createTransport({ host: SMTP_HOST, port, secure: port === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
  await transport.sendMail({ from: DIGEST_FROM || SMTP_USER, to: msg.to.email, subject: msg.subject, text: msg.text, html: msg.html });
}

const GRAPH = 'https://graph.facebook.com/v20.0';
const whatsappSend = () => { const v = (process.env.WHATSAPP_SEND || 'image').trim().toLowerCase(); return v === 'text' || v === 'both' ? v : 'image'; };

async function whatsappPost(path, body, headers = {}) {
  const { WHATSAPP_TOKEN, WHATSAPP_PHONE_ID } = process.env;
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) throw new Error('WHATSAPP_TOKEN and WHATSAPP_PHONE_ID are not set');
  const res = await fetch(`${GRAPH}/${WHATSAPP_PHONE_ID}/${path}`, { method: 'POST', headers: { authorization: `Bearer ${WHATSAPP_TOKEN}`, ...headers }, body });
  if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
const whatsappJson = (path, obj) => whatsappPost(path, JSON.stringify(obj), { 'content-type': 'application/json' });

/** Text template (or plain text when WHATSAPP_TEMPLATE=none). */
async function sendWhatsAppText(msg, to) {
  const template = (process.env.WHATSAPP_TEMPLATE || 'pending_tasks_daily').trim();
  const body = template.toLowerCase() === 'none'
    ? { messaging_product: 'whatsapp', to, type: 'text', text: { body: msg.text } }
    : { messaging_product: 'whatsapp', to, type: 'template', template: { name: template, language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'en' }, components: [{ type: 'body', parameters: (msg.params || []).map((p) => ({ type: 'text', text: String(p) })) }] } };
  await whatsappJson('messages', body);
}

/** The table picture: uploaded once per message, then sent as the template's image header. */
const mediaIds = new Map();
async function uploadPng(png, name) {
  if (mediaIds.has(name)) return mediaIds.get(name);
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'image/png');
  form.append('file', new Blob([png], { type: 'image/png' }), name);
  const { id } = await whatsappPost('media', form);
  if (!id) throw new Error('media upload returned no id');
  mediaIds.set(name, id);
  return id;
}
async function sendWhatsAppImage(msg, to) {
  const png = messagePng(msg, digest);
  if (!png) throw new Error(`no table to draw for ${msg.team}`);
  const name = `${(msg.team === '*' ? 'all-teams' : msg.team).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${digest.date}.png`;
  const id = await uploadPng(png, name);
  const template = (process.env.WHATSAPP_IMAGE_TEMPLATE || 'pending_tasks_image').trim();
  const [team, date, overdue, today] = msg.params || [];
  const caption = `${team} · pending tasks · ${date}: ${overdue} overdue, ${today} due today`;
  const body = template.toLowerCase() === 'none'
    ? { messaging_product: 'whatsapp', to, type: 'image', image: { id, caption } }
    : { messaging_product: 'whatsapp', to, type: 'template', template: { name: template, language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'en' }, components: [
        { type: 'header', parameters: [{ type: 'image', image: { id } }] },
        { type: 'body', parameters: [team, date, overdue, today].map((p) => ({ type: 'text', text: String(p ?? '') })) },
      ] } };
  await whatsappJson('messages', body);
}

async function sendWhatsApp(msg) {
  const to = String(msg.to.whatsapp).replace(/\D/g, '');
  const mode = whatsappSend();
  if (mode !== 'text') await sendWhatsAppImage(msg, to);
  if (mode !== 'image') await sendWhatsAppText(msg, to);
}

const pending = await loadPending();
const digest = buildDigest(pending, { target, rule: process.env.DIGEST_RULE === 'owner' ? 'owner' : 'exec' });
console.log(`Snapshot ${digest.date}: ${digest.teams.length} teams, ${digest.teams.reduce((a, t) => a + t.overdue, 0)} overdue, target under ${target} per executive.`);

let list = recipients();
if (!list && !dryRun) { console.log('DIGEST_RECIPIENTS is not set; nothing to send. Add the secret to start the morning digest.'); process.exit(0); }
if (!list) {
  // preview for every team plus the summary, addressed to nobody
  list = [{ team: '*', email: 'preview' }, ...digest.teams.map((t) => ({ team: t.team, email: 'preview' }))];
}
const messages = planMessages(digest, list, url);

if (dryRun) {
  mkdirSync(outDir, { recursive: true });
  for (const m of messages) {
    if (m.skipped) { console.log(`skip ${JSON.stringify(m.to)}: ${m.skipped}`); continue; }
    const name = (m.team === '*' ? 'all-teams' : m.team).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    writeFileSync(join(outDir, `${name}.html`), m.html);
    writeFileSync(join(outDir, `${name}.txt`), m.text);
    writeFileSync(join(outDir, `${name}.template.json`), JSON.stringify(m.params, null, 1));
    const png = messagePng(m, digest);
    if (png) writeFileSync(join(outDir, `${name}.png`), png);
    console.log(`rendered ${name} (${m.subject})`);
  }
  console.log(`Dry run: ${messages.filter((m) => !m.skipped).length} messages written to ${outDir}/, nothing sent.`);
} else {
  let sent = 0, failed = 0;
  for (const m of messages) {
    if (m.skipped) { console.log(`skip: ${m.skipped}`); continue; }
    const who = m.to.name || m.to.email || m.to.whatsapp;
    if (m.to.email) { try { await sendEmail(m); sent++; console.log(`email sent to ${who} for ${m.team}`); } catch (e) { failed++; console.error(`email to ${who} failed: ${e.message}`); } }
    if (m.to.whatsapp) { try { await sendWhatsApp(m); sent++; console.log(`WhatsApp sent to ${who} for ${m.team}`); } catch (e) { failed++; console.error(`WhatsApp to ${who} failed: ${e.message}`); } }
  }
  console.log(`Done: ${sent} sent, ${failed} failed.`);
  if (failed && !sent) process.exit(1);
}
