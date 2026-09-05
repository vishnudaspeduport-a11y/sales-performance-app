// POST /api/sync  (header x-sync-secret: <SYNC_SECRET>) → queues a background sync
import { authorized, json, queueSync } from '../../server/api.mjs';
import { createSupabaseRepo } from '../../server/repo.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, { status: 405 });
  if (!authorized(req)) return json({ error: 'Unauthorized.' }, { status: 401 });
  try {
    const result = await queueSync({ repo: createSupabaseRepo(), req, trigger: 'manual' });
    return json(result, { status: result.queued ? 202 : 200, headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    return json({ error: String(err?.message || err) }, { status: 500 });
  }
};

export const config = { path: '/api/sync' };
