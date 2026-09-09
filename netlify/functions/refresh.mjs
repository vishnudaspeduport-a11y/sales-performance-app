// POST /api/refresh → queues a background sync (throttled) and reports the current snapshot time
import { handleRefresh, json } from '../../server/api.mjs';
import { createSupabaseRepo } from '../../server/repo.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, { status: 405 });
  try {
    return await handleRefresh({ repo: createSupabaseRepo(), req });
  } catch (err) {
    return json({ error: String(err?.message || err) }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
};

export const config = { path: '/api/refresh' };
