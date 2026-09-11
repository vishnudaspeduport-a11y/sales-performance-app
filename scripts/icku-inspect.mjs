/**
 * Read-only inventory of what the icku database login can see: schemas, tables, views,
 * their columns and row counts. Prints metadata only; no data rows are read.
 *
 * Uses the same ICKU_DB_* settings as the sync (see server/directory.mjs).
 *   node scripts/icku-inspect.mjs
 */
import { createRequire } from 'node:module';
import { directoryConfig } from '../server/directory.mjs';

const require = createRequire(import.meta.url);

const cfg = directoryConfig();
if (!cfg) { console.error('icku database is not configured (ICKU_DB_HOST or ICKU_DB_URL)'); process.exit(1); }

const { Client } = require('pg');
const ssl = cfg.ca ? { ca: cfg.ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
const client = new Client(cfg.url
  ? { connectionString: cfg.url, ssl, application_name: 'sales-dashboard-inspect', statement_timeout: 60000 }
  : { host: cfg.host, port: cfg.port, database: cfg.database, user: cfg.user, password: cfg.password, ssl, application_name: 'sales-dashboard-inspect', statement_timeout: 60000 });

const q = async (sql, params) => (await client.query(sql, params)).rows;
const pad = (s, n) => String(s ?? '').padEnd(n);

await client.connect();
try {
  await client.query('set default_transaction_read_only = on');
  const [{ current_user: user, current_database: db }] = await q('select current_user, current_database()');
  console.log(`Login: ${user} on database ${db}`);

  const schemas = await q(`select nspname from pg_namespace
    where nspname not in ('pg_catalog','information_schema','pg_toast') and nspname not like 'pg_temp%' and nspname not like 'pg_toast%'
      and has_schema_privilege(nspname, 'USAGE') order by 1`);
  console.log(`\nSchemas this login can use: ${schemas.map((r) => r.nspname).join(', ') || '(none)'}`);

  const rels = await q(`
    select n.nspname as schema, c.relname as name,
           case c.relkind when 'r' then 'table' when 'v' then 'view' when 'm' then 'materialized view' when 'p' then 'partitioned table' when 'f' then 'foreign table' else c.relkind::text end as kind,
           greatest(c.reltuples, 0)::bigint as est_rows,
           obj_description(c.oid, 'pg_class') as comment,
           has_table_privilege(c.oid, 'SELECT') as can_select
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r','v','m','p','f')
      and n.nspname not in ('pg_catalog','information_schema','pg_toast') and n.nspname not like 'pg_temp%' and n.nspname not like 'pg_toast%'
      and has_schema_privilege(n.oid, 'USAGE')
    order by n.nspname, c.relkind, c.relname`);
  const readable = rels.filter((r) => r.can_select);
  console.log(`\n=== Objects visible: ${rels.length}, readable by this login: ${readable.length}`);
  for (const r of rels) console.log(`${pad(r.schema, 12)} ${pad(r.kind, 18)} ${pad(r.name, 44)} select=${r.can_select ? 'yes' : 'no '}${r.comment ? '  // ' + r.comment : ''}`);

  console.log('\n=== Columns of readable objects');
  for (const r of readable) {
    const cols = await q(`select column_name, data_type, is_nullable from information_schema.columns where table_schema = $1 and table_name = $2 order by ordinal_position`, [r.schema, r.name]);
    let count = 'n/a';
    try { const [{ n }] = await q(`select count(*)::bigint as n from "${r.schema.replace(/"/g, '""')}"."${r.name.replace(/"/g, '""')}"`); count = String(n); } catch (e) { count = `count failed: ${e.message}`; }
    console.log(`\n-- ${r.schema}.${r.name} (${r.kind}) · rows: ${count}`);
    for (const c of cols) console.log(`   ${pad(c.column_name, 36)} ${pad(c.data_type, 28)} ${c.is_nullable === 'NO' ? 'not null' : 'nullable'}`);
  }

  const fns = await q(`select n.nspname as schema, p.proname as name, pg_get_function_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog','information_schema') and has_function_privilege(p.oid, 'EXECUTE')
      and has_schema_privilege(n.oid, 'USAGE') and n.nspname not like 'pg_%'
    order by 1, 2 limit 200`);
  if (fns.length) { console.log(`\n=== Functions this login may call: ${fns.length}`); for (const f of fns) console.log(`   ${f.schema}.${f.name}(${f.args})`); }
} finally {
  await client.end();
}
