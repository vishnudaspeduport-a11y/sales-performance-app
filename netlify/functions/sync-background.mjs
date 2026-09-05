// Background function (the "-background" suffix gives it up to 15 minutes).
// Reads the Google Sheet, upserts Supabase and stores a fresh snapshot.
import { authorized } from '../../server/api.mjs';
import { createSupabaseRepo } from '../../server/repo.mjs';
import { runSync } from '../../server/sync.mjs';

export default async (req) => {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 });
  let trigger = 'manual';
  try { trigger = (await req.json())?.trigger || trigger; } catch { /* no body */ }
  try {
    const result = await runSync({ repo: createSupabaseRepo(), trigger });
    console.log('sync finished', JSON.stringify(result));
  } catch (err) {
    console.error('sync failed', err);
  }
  return new Response('done');
};
