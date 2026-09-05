// GET /api/data            → latest dashboard payload (cached ~3 min at the CDN)
// GET /api/data?refresh=1  → same, and queues a fresh sync from the Google Sheet
import { handleData, json } from '../../server/api.mjs';
import { createSupabaseRepo } from '../../server/repo.mjs';

export default async (req) => {
  try {
    return await handleData({ repo: createSupabaseRepo(), req });
  } catch (err) {
    console.error('data function failed', err);
    return json({ error: 'The data service could not read the database.', detail: String(err?.message || err) }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
};

export const config = { path: '/api/data' };
