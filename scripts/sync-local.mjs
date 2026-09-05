/**
 * Run one sync from the command line against the real Supabase + Google Sheet.
 *   node scripts/sync-local.mjs
 * Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and GOOGLE_SERVICE_ACCOUNT_JSON (see .env.example).
 */
import { createSupabaseRepo } from '../server/repo.mjs';
import { runSync } from '../server/sync.mjs';
import { loadEnv } from './env.mjs';

loadEnv();
const t0 = Date.now();
try {
  const result = await runSync({ repo: createSupabaseRepo(), trigger: 'cli' });
  console.log(JSON.stringify(result, null, 2));
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} catch (err) {
  console.error('Sync failed:', err.message);
  process.exit(1);
}
