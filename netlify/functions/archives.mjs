// GET /api/archives → list of archived call-log days
import { handleArchives, json } from '../../server/api.mjs';
import { createSupabaseRepo } from '../../server/repo.mjs';

export default async () => {
  try {
    return await handleArchives({ repo: createSupabaseRepo() });
  } catch (err) {
    return json({ error: 'Could not list archives.', detail: String(err?.message || err) }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
};

export const config = { path: '/api/archives' };
