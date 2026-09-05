// GET /api/health → last sync status
import { handleHealth, json } from '../../server/api.mjs';
import { createSupabaseRepo } from '../../server/repo.mjs';

export default async () => {
  try {
    return await handleHealth({ repo: createSupabaseRepo() });
  } catch (err) {
    return json({ ok: false, error: String(err?.message || err) }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
};

export const config = { path: '/api/health' };
