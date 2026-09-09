/**
 * Run one sync against the real Supabase + Google Sheet. Used from the command line and
 * by the GitHub Actions workflow (.github/workflows/sync.yml).
 *   node scripts/sync-local.mjs [--trigger manual|scheduled|cli]
 * Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and GOOGLE_SERVICE_ACCOUNT_JSON (see .env.example).
 * A "scheduled" run skips all database work when the sheet is unchanged; "manual" always rebuilds.
 */
import { createSupabaseRepo } from '../server/repo.mjs';
import { runSync } from '../server/sync.mjs';
import { arg, loadEnv } from './env.mjs';

loadEnv();
const trigger = ['manual', 'scheduled', 'cli'].includes(arg('--trigger', 'cli')) ? arg('--trigger', 'cli') : 'cli';
const t0 = Date.now();
try {
  const result = await runSync({ repo: createSupabaseRepo(), trigger });
  console.log(JSON.stringify(result, null, 2));
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} catch (err) {
  console.error('Sync failed:', err.message);
  process.exit(1);
}
