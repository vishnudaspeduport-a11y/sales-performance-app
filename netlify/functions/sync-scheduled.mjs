// Runs every 5 minutes on Netlify and queues the background sync, so new rows
// in the Google Sheet reach the dashboard without anyone touching the code.
import { queueSync } from '../../server/api.mjs';
import { createSupabaseRepo } from '../../server/repo.mjs';

export default async (req) => {
  const result = await queueSync({ repo: createSupabaseRepo(), req, trigger: 'scheduled' });
  console.log('scheduled sync', JSON.stringify(result));
  return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
};

// Every 2 hours (on the hour). The Refresh Data button forces a sync at any time;
// runs whose sheet content is unchanged skip all database work.
export const config = { schedule: '0 */2 * * *' };
