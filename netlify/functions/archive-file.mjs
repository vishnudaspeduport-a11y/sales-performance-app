// GET /api/archives/:date  (?key=<DOWNLOAD_KEY>) → that day's call log as CSV
import { handleArchiveFile, json } from '../../server/api.mjs';
import { createSupabaseRepo } from '../../server/repo.mjs';

export default async (req, context) => {
  try {
    const date = context?.params?.date ?? new URL(req.url).pathname.split('/').pop();
    return await handleArchiveFile({ repo: createSupabaseRepo(), req, date });
  } catch (err) {
    return json({ error: 'Could not read the archive.', detail: String(err?.message || err) }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
};

export const config = { path: '/api/archives/:date' };
