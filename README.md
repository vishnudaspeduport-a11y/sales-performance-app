# Sales Team Performance Dashboard

Read-only Sales Performance Intelligence dashboard for the daily calling
activity in the **Input DB** Google Sheet.

```
Google Sheet ──(every 5 min, service account)──▶ Netlify background function
                                                      │  transform + upsert
                                                      ▼
                                                 Supabase Postgres
                                                      │  prebuilt snapshot
Browser ◀──── Netlify CDN (cached 3 min) ◀──── /api/data (Netlify function)
```

* **Frontend** – React 18, TypeScript, Tailwind, Recharts (Vite). `src/`
* **API** – Netlify Functions v2 (`netlify/functions/`), logic in `server/`
* **Database** – Supabase Postgres (`supabase/migrations/`)
* **Sync** – scheduled function → background function that reads the sheet
  with a Google service account and upserts `employees`, `daily_activity`,
  and a prebuilt `dashboard_snapshots` row that `/api/data` serves.
* **CI** – GitHub Actions typecheck + build on every push; Netlify deploys `main`.

Nothing secret reaches the browser: the frontend only calls `/api/data`.

---

## 1. Supabase (database) — 3 minutes

1. <https://supabase.com/dashboard> → **New project** (any region; note the DB password).
2. **SQL Editor → New query** → paste `supabase/migrations/20260905000000_init.sql` → **Run**.
3. **Project Settings → API**: copy the **Project URL** and the **service_role** key
   (server-side only).

## 2. Google service account (read access to the sheet) — 5 minutes

1. <https://console.cloud.google.com> → create/select a project → **APIs & Services → Library** → enable **Google Sheets API**.
2. **IAM & Admin → Service Accounts → Create service account** (any name) → **Keys → Add key → JSON** → download.
3. Open the Google Sheet → **Share** → add the service account's `client_email` as **Viewer**.

## 3. GitHub — 2 minutes

```bash
git remote add origin https://github.com/<you>/sales-performance-app.git
git push -u origin main
```

## 4. Cloudflare + GitHub Actions (free hosting, API and sync) — 15 minutes

Current setup. The page and a tiny API run on a Cloudflare Worker (free plan, no
credit balance, free deploys); the Google Sheet sync runs in a GitHub Actions
workflow every 2 hours and whenever **Refresh Data** is pressed. Netlify (section 5)
is the previous host and is no longer needed.

```
Google Sheet ──(GitHub Actions, every 2 h / on demand)──▶ scripts/sync-local.mjs
                                                              │  transform + upsert + archive
                                                              ▼
                                                         Supabase Postgres + Storage
                                                              │  latest_snapshot() RPC
Browser ◀──── Cloudflare edge cache (5 min) ◀──── worker/index.mjs (/api/*) + dist/ assets
```

1. Supabase → **SQL Editor** → run `supabase/migrations/20260910000000_latest_snapshot_rpc.sql`.
2. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**, add:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `SHEET_ID`
   (same values as the Netlify environment variables). Then **Actions → Sync dashboard data → Run workflow**
   once to confirm it goes green.
3. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**:
   repository access = only this repo, permission **Actions: Read and write**. Copy the token for step 5.
4. <https://dash.cloudflare.com> → **Workers & Pages → Create → Import a repository** → pick the repo.
   Build command `npm run build`, deploy command `npx wrangler deploy` (settings come from `wrangler.toml`).
5. Worker → **Settings → Variables and Secrets** → add as **Secret**:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_TOKEN` (step 3), `DOWNLOAD_KEY`, `SYNC_SECRET`.
   Redeploy once (Deployments → Retry, or push a commit). Every later push to `main` deploys itself.
6. Open `https://eduportsales.<account>.workers.dev` — that is the shareable URL.
   `…/api/health` shows the last sync; **Refresh Data** queues a workflow run and the page
   reloads by itself when the new snapshot lands (about 2 minutes).

Local check without secrets: `node scripts/test-worker.mjs` and `npx wrangler deploy --dry-run --outdir /tmp/w`.

## 5. Netlify (previous host) — 5 minutes

1. <https://app.netlify.com> → **Add new site → Import an existing project → GitHub** → pick the repo.
   Build settings are read from `netlify.toml` (build `npm run build`, publish `dist`).
2. **Site configuration → Environment variables** → add (see `.env.example`):

   | Variable | Value |
   |---|---|
   | `SUPABASE_URL` | Project URL from step 1 |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key from step 1 |
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | the JSON key file contents (raw or base64) |
   | `SHEET_ID` | `1vUh-9oDKVtijuhQLsihm7SGCBDT7PhSSbrvvkElyQrg` |
   | `SYNC_SECRET` | any long random string |
   | `CACHE_SECONDS` | `180` |

3. **Deploy site**. The scheduled function runs every 2 hours (or press Refresh Data) and fills the database.
   To fill it immediately: `curl -X POST -H "x-sync-secret: <SYNC_SECRET>" https://<site>.netlify.app/api/sync`
4. Open `https://<site>.netlify.app` — that is the shareable URL (no sign-in).
   `…/api/health` shows the last sync; `…/api/data` is the JSON.

New rows in the sheet appear automatically on the next scheduled sync (every 2 hours); the
**Refresh Data** button forces a sync (throttled to once a minute).

## 5b. icku HR directory (team mapping) — 5 minutes

When connected, managers, titles, locations, joining dates and working status come from the
icku HR database (read-only view `da.employee_directory`) instead of the sheet's Employee Data
tab, and the **Team Mapping** page shows every manager with their executives, the people with no
manager ("Unassigned", also selectable in the Manager filter), people with call data who are not
in the directory, and executives whose CRM team (Pending Tasks sheet) differs from their HR manager.
Only non-personal columns are read; date_of_birth and gender are never selected.

1. Supabase → SQL Editor → run `supabase/migrations/20260912000000_employee_directory_fields.sql`.
2. GitHub repo → Settings → Secrets and variables → Actions → add `ICKU_DB_HOST`, `ICKU_DB_USER`,
   `ICKU_DB_PASSWORD`, `ICKU_DB_NAME` (`postgres`) and, for a verify-full connection, `ICKU_DB_SSL_CA`
   (the database CA certificate in PEM form). Without the CA the connection is encrypted but unverified,
   and the sync says so in its notes.
3. Run the sync once (Actions → Sync dashboard data → Run workflow, or Refresh Data). If the database
   cannot be reached the sync falls back to the sheet mapping and notes why.

To correct a mapping, change "Reporting To" in icku; the dashboard follows at the next sync.

## 6. Call-log archive (optional) — 2 minutes

The sheet's `Raw data` tab is overwritten every day. To keep each day's
call-level rows (all columns, as displayed in the sheet):

1. Supabase → **SQL Editor** → run `supabase/migrations/20260907000000_call_log_archive.sql`
   (creates the private `call-log-archive` storage bucket and an index table).
2. Netlify → Environment variables → add `DOWNLOAD_KEY` (the password people
   must enter to download call-level files; defaults to `SYNC_SECRET`) →
   trigger a deploy.

Every sync then saves one gzip-compressed CSV per call date. The **Raw Data**
page lists the archived days with a download button; `/api/archives` lists
them and `/api/archives/<YYYY-MM-DD>.csv?key=…` downloads one. Aggregated
dashboard data stays public; only the call-level files need the key because
they contain phone numbers.

## 7. Call-duration bands (optional) — 1 minute

Run `supabase/migrations/20260907100000_duration_bands.sql` in the SQL Editor.
Each sync then counts connected calls per employee-day in three bands
(0–2 min, 2–4 min, over 4 min) from the call log, and rebuilds them from the
archived CSVs for retained days that have none. Days that exist only in
`Helper - Raw` have no call detail, so the dashboard labels band figures with
the days they cover.

---

## Data model

The first step was reading the workbook's real headers. The `DB` tab is a
parameterised report (From/To/Manager inputs + lookup formulas), not a flat
daily table, so `server/transform.mjs` works in layers and records which one it
used in `meta.sourceMode`:

| Mode | When | Source |
|---|---|---|
| `db-flat` | `DB` gains a header row with Date + Employee + call columns | `DB` directly |
| `helper-raw` | otherwise | `Helper - Raw` (rows = Date × metric, columns = Emp Id, talk time in decimal hours) |
| `+raw-log` | call-level rows exist for dates the helper does not cover | `Raw data` aggregated per employee-day (Outgoing → Dialed, Incoming, connected when Duration > 0) |

Names, managers and status come from directory tabs with `Emp Id` + `Name`
headers (`Employee Data`, `Resigned`, …) and from the call log's
`Employee Name` / `Emp. Tags`. Columns are matched by alias — edit
`CONCEPT_ALIASES` in `server/transform.mjs` to remap. Blank rows, `#N/A`,
numbers stored as text, duplicates, mixed date formats and talk time in
`HH:MM:SS` / `1h 2m 3s` / seconds / decimal hours are all normalised. Dates are
IST calendar dates end-to-end.

Derived metrics live in `src/config/metrics.ts`. The **Performance Score**
(35 % calls, 30 % connected, 20 % talk time, 15 % connection rate, per active
day, normalised to the team's 90th percentile) is a calculated dashboard metric
and is labelled as such. Any metric whose source columns are missing is hidden.

Tables: `employees`, `daily_activity` (one row per employee-day),
`sync_runs` (audit), `dashboard_snapshots` (served payload), and the
`daily_activity_named` view for SQL/BI tools. Row Level Security allows public
reads only; all writes use the service role inside the functions.

## Local development

```bash
npm install
# Option A — no cloud: export the sheet as .xlsx (File → Download → Excel)
node scripts/dev-api.mjs --workbook ~/Downloads/export.xlsx      # API on :8787 (in-memory DB)
npm run dev                                                      # Vite on :5173, proxies /api
# Option B — real Supabase + Google Sheet: copy .env.example to .env and fill it in
npm run dev:api && npm run dev
npm run sync            # one-off sync from the CLI
npm run selftest -- --workbook export.xlsx   # end-to-end test (sync → API → checks)
node scripts/dev-api.mjs --workbook export.xlsx --static          # serve dist/ + API on :8787
```

## Configuration knobs

| Where | What |
|---|---|
| `netlify/functions/sync-scheduled.mjs` | sync cadence (`0 */2 * * *`, every 2 hours; Refresh Data forces one) |
| `CACHE_SECONDS` | CDN/browser cache for `/api/data` |
| `server/config.mjs` | refresh throttle, stale-run timeout |
| `src/config/metrics.ts` | KPI definitions, score weights & bands, attention defaults |
| `DIRECTORY_SHEETS`, `HELPER_SHEET`, `RAW_SHEET` env | which tabs to read |
