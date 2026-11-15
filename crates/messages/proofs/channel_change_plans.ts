#!/usr/bin/env bun
// Measure exact channel SQL on fresh and stale disposable local databases.
//
// No existing database is modified or removed. Results include the exact SQL,
// seed and first/repeated JSON plans for custom and generic prepared statements.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decodeJsonAt,
  encodeJson,
  type Json,
  numberText,
} from './plan_json';
import {
  parseCommandLine,
  ProofError,
  runProof,
  strip,
  usageError,
} from './proof_support';

const HELP = `usage: channel_change_plans.ts [-h] [--host {127.0.0.1,localhost,::1}]
                               --port PORT --user USER
                               [--maintenance-db MAINTENANCE_DB]
                               [--suffix SUFFIX] [--output OUTPUT]

Measure exact channel SQL on fresh and stale disposable local databases. No
existing database is modified or removed. Results include the exact SQL, seed
and first/repeated JSON plans for custom and generic prepared statements.

options:
  -h, --help            show this help message and exit
  --host {127.0.0.1,localhost,::1}
  --port PORT           Port of a dedicated local test Postgres
  --user USER           Your local test database role
  --maintenance-db MAINTENANCE_DB
  --suffix SUFFIX
  --output OUTPUT       Directory for plans; defaults under /tmp
`;

const ROOT = join(import.meta.dir, '../../..');
const HOSTS = ['127.0.0.1', 'localhost', '::1'];
const REPO = 'crates/messages/src/outbound/pg_message_repo';
const TABLES = [
  'channel_change_counters',
  'channel_change_log',
  'comms_channels',
  'comms_messages',
  'comms_message_threads',
  'comms_attachments',
  'comms_reactions',
  'comms_entity_mentions',
  'activity_events',
  'bots',
];
const SETTINGS =
  "SET random_page_cost=1.1; SET work_mem='16MB'; SET jit=off; SET statement_timeout='60s';\n";

// All rows and identifiers are synthetic. Disable triggers only in these new
// disposable databases; the proof exercises the read/index paths, not imports.
const SEED = `
SET session_replication_role = replica;
INSERT INTO comms_channels(id,channel_type,owner_id)
SELECT lpad(to_hex(n),32,'0')::uuid,'private','macro|plan@example.com' FROM generate_series(20,29)n ON CONFLICT DO NOTHING;
INSERT INTO channel_change_counters(channel_id,seq)
SELECT lpad(to_hex(n),32,'0')::uuid,100000 FROM generate_series(20,29)n ON CONFLICT DO NOTHING;
INSERT INTO channel_change_log(channel_id,seq,kind,message_id,created_at)
SELECT lpad(to_hex(20+(n-1)/100000),32,'0')::uuid,1+(n-1)%100000,1,
       lpad(to_hex(10000000+n),32,'0')::uuid,
       '2026-09-01 00:00:00+00'::timestamptz+n*interval '1 microsecond'
FROM generate_series(1,1000000)n ON CONFLICT DO NOTHING;
INSERT INTO comms_messages(id,parent_entity_type,parent_entity_id,thread_id,sender_id,content,created_at,updated_at)
SELECT lpad(to_hex(10000000+n),32,'0')::uuid,
       'channel',lpad(to_hex(20+(n-1)/100000),32,'0')::uuid::text,
       CASE WHEN (n-1)%100=0 THEN NULL ELSE lpad(to_hex(10000001+(n-1)/100*100),32,'0')::uuid END,
       'macro|plan@example.com','message '||n,
       '2026-09-01 00:00:00+00'::timestamptz+n*interval '1 microsecond',
       '2026-09-01 00:00:00+00'::timestamptz+n*interval '1 microsecond'
FROM generate_series(1,1000000)n ON CONFLICT DO NOTHING;
INSERT INTO comms_message_threads(root_id,parent_entity_type,parent_entity_id,user_id,created_at,updated_at)
SELECT id,parent_entity_type,parent_entity_id,sender_id,created_at,updated_at FROM comms_messages WHERE thread_id IS NULL ON CONFLICT DO NOTHING;
INSERT INTO comms_attachments(id,message_id,entity_type,entity_id,created_at)
SELECT lpad(to_hex(20000000+n),32,'0')::uuid,lpad(to_hex(10000000+n),32,'0')::uuid,
       'document','plan-'||n,'2026-09-01 00:00:00+00'::timestamptz+n*interval '1 microsecond'
FROM generate_series(1,1000000)n ON CONFLICT DO NOTHING;
INSERT INTO comms_reactions(message_id,emoji,user_id)
SELECT lpad(to_hex(10000000+n),32,'0')::uuid,'x','macro|plan@example.com' FROM generate_series(1,1000000)n ON CONFLICT DO NOTHING;
INSERT INTO comms_entity_mentions(id,entity_type,entity_id,source_entity_type,source_entity_id)
SELECT lpad(to_hex(40000000+n),32,'0')::uuid,'user','macro|plan@example.com','message',lpad(to_hex(10000000+n),32,'0')::uuid::text
FROM generate_series(1,1000000)n ON CONFLICT DO NOTHING;
INSERT INTO activity_events(id,actor_id,subject_id,action,action_payload,entity_type,entity_id,occurred_at)
SELECT lpad(to_hex(30000000+n),32,'0')::uuid,'macro|plan@example.com','macro|plan@example.com','renamed',
       '{"from":"before","to":"after"}'::jsonb,'channel',lpad(to_hex(20+(n-1)/100000),32,'0')::uuid::text,
       '2026-09-01 00:00:00+00'::timestamptz+n*interval '1 microsecond'
FROM generate_series(1,1000000)n ON CONFLICT DO NOTHING;
SET session_replication_role=origin;
`;
const SUPPLEMENTAL_SEED = `SET session_replication_role=replica;

INSERT INTO channel_change_counters(channel_id,seq)
SELECT lpad(to_hex(n),32,'0')::uuid,0 FROM generate_series(1000,100999)n ON CONFLICT DO NOTHING;
INSERT INTO comms_channels(id,channel_type,owner_id)
VALUES ('00000000-0000-0000-0000-00000000001e','private','macro|plan@example.com') ON CONFLICT DO NOTHING;
INSERT INTO comms_messages(id,parent_entity_type,parent_entity_id,sender_id,content,created_at,updated_at)
SELECT lpad(to_hex(11000000+n),32,'0')::uuid,'channel','00000000-0000-0000-0000-00000000001e',
'macro|plan@example.com','background root',now(),now() FROM generate_series(1,990000)n ON CONFLICT DO NOTHING;
INSERT INTO comms_message_threads(root_id,parent_entity_type,parent_entity_id,user_id,created_at,updated_at)
SELECT id,parent_entity_type,parent_entity_id,sender_id,created_at,updated_at FROM comms_messages
WHERE thread_id IS NULL ON CONFLICT DO NOTHING;
INSERT INTO bots(id,kind,owner_user_id,name,handle)
SELECT lpad(to_hex(50000000+n),32,'0')::uuid,'owned','macro|plan@example.com','Plan Bot','plan-bot-'||n
FROM generate_series(1,100000)n ON CONFLICT DO NOTHING;
SET session_replication_role=origin;
`;

/** A prepared statement: its name, parameter types, SQL and arguments. */
type Query = { name: string; types: string; sql: string; params: string };

function readSource(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8').replace(/\r\n?/g, '\n');
}

// Every Rust raw string literal in the file, in source order.
function rawStrings(path: string): string[] {
  const literals = readSource(path).matchAll(/r#"(.*?)"#/gs);
  return Array.from(literals, (match) => match[1] ?? '');
}

function pick(queries: string[], mark: string): string {
  const query = queries.find((candidate) => candidate.includes(mark));
  if (query === undefined) {
    throw new ProofError(`no query contains ${JSON.stringify(mark)}`);
  }

  return query;
}

function capture(source: string, pattern: RegExp): string {
  const captured = pattern.exec(source)?.[1];
  if (captured === undefined) {
    throw new ProofError(`no match for ${pattern.source}`);
  }

  return captured;
}

function uuid(value: number): string {
  const hex = value.toString(16).padStart(32, '0');
  const groups = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ];
  return groups.join('-');
}

function quotedUuid(value: number): string {
  return `'${uuid(value)}'`;
}

function sqlArray(items: string[], type = 'uuid'): string {
  return `'{${items.join(',')}}'::${type}[]`;
}

// Percent-encodes everything except unreserved URL characters.
function quote(text: string): string {
  return encodeURIComponent(text).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

// The 200 thread roots at every hundredth seeded message.
function rootOffsets(): number[] {
  return Array.from({ length: 200 }, (_, index) => 1 + index * 100);
}

function buildQueries(): Query[] {
  const changes = rawStrings(`${REPO}/changes.rs`);
  const changeReads = rawStrings('crates/channel_change_db_utils/src/read.rs');
  const changePruning = rawStrings(
    'crates/channel_change_db_utils/src/prune.rs'
  );
  const timeline = rawStrings(`${REPO}/timeline.rs`);
  const repo = readSource(`${REPO}.rs`);
  const repoQueries = rawStrings(`${REPO}.rs`);
  const ids = rawStrings('crates/activity/src/outbound/pg_activity_repo/ids.rs');
  const writeHydration = pick(
    rawStrings(`${REPO}/write_hydration.rs`),
    'SELECT to_jsonb(m)'
  );
  const threads = rawStrings(`${REPO}/threads.rs`);

  const rootIds = rootOffsets().map((n) => uuid(10000000 + n));
  const hydrateIds = rootOffsets().flatMap((n) =>
    [0, 1, 2, 3].map((i) => uuid(10000000 + n + i))
  );
  const activityIds = Array.from({ length: 200 }, (_, index) =>
    uuid(30000001 + index)
  );
  const botIds = Array.from({ length: 800 }, (_, index) =>
    uuid(50000001 + index)
  );
  const channel = quotedUuid(20);
  const position = pick(changeReads, 'WITH position');
  const positionTypes = 'uuid,bigint,bigint,bigint';
  const firstActivityQuery = ids[0];
  if (firstActivityQuery === undefined) {
    throw new ProofError('no activity id query');
  }

  const query = (
    name: string,
    types: string,
    sql: string,
    params: string
  ): Query => ({ name, types, sql, params });

  return [
    query(
      'write_hydration',
      'uuid,text',
      writeHydration,
      `${quotedUuid(10000001)},${channel}`
    ),
    query(
      'write_hydration_missing',
      'uuid,text',
      writeHydration,
      `${quotedUuid(99999999)},${channel}`
    ),
    query(
      'reply_root_lock',
      'uuid,text,text',
      pick(threads, 'FOR KEY SHARE'),
      `${quotedUuid(10000001)},'channel',${channel}`
    ),
    query('counter', 'uuid', pick(changeReads, 'SELECT COALESCE'), channel),
    query(
      'log_caught_up',
      positionTypes,
      position,
      `${channel},100000,1000,1001`
    ),
    query('log_delta', positionTypes, position, `${channel},99500,1000,1001`),
    query('log_lagged', positionTypes, position, `${channel},0,1000,1001`),
    query(
      'log_missing',
      positionTypes,
      position,
      `${quotedUuid(999)},0,1000,1001`
    ),
    query(
      'changed_messages',
      'uuid[],text',
      pick(changes, 'SELECT to_jsonb(message)'),
      `${sqlArray(rootIds)},${channel}`
    ),
    query(
      'root_rows',
      'uuid[]',
      pick(changes, 'SELECT to_jsonb(m)'),
      sqlArray(rootIds)
    ),
    query(
      'root_states',
      'uuid[]',
      pick(timeline, 'SELECT t.root_id'),
      sqlArray(rootIds)
    ),
    query(
      'root_previews',
      'uuid[]',
      pick(timeline, 'SELECT to_jsonb(preview)'),
      sqlArray(rootIds)
    ),
    query(
      'attachments',
      'uuid[]',
      pick(repoQueries, 'SELECT message_id, id, entity_type'),
      sqlArray(hydrateIds)
    ),
    query(
      'reactions',
      'uuid[]',
      pick(repoQueries, 'SELECT message_id, emoji, array_agg'),
      sqlArray(hydrateIds)
    ),
    query(
      'mentions',
      'text[]',
      capture(repo, /sqlx::query!\("(SELECT source_entity_id[^"\n]+)"/),
      sqlArray(hydrateIds, 'text')
    ),
    query(
      'bots',
      'uuid[]',
      capture(
        repo,
        /"(SELECT id, name, avatar_url FROM bots WHERE id = ANY\(\$1\))"/
      ),
      sqlArray(botIds)
    ),
    query(
      'activities',
      'uuid[],text,text,text[],text[]',
      firstActivityQuery,
      `${sqlArray(activityIds)},'channel',${channel},'{renamed}'::text[],'{}'::text[]`
    ),
    query(
      'prune',
      'timestamptz,bigint',
      pick(changePruning, 'WHERE ctid'),
      "'2026-10-13 00:00:00+00',10000"
    ),
  ];
}

// The current UTC time as YYYYMMDD_HHMMSS_ffffff.
function timestampSuffix(): string {
  const digits = new Date().toISOString().replace(/[-:TZ.]/g, '');
  return `${digits.slice(0, 8)}_${digits.slice(8, 14)}_${digits.slice(14)}000`;
}

// Drops empty and `.` segments and any trailing slash, keeping `..`.
function cleanPath(path: string): string {
  const segments = path
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');
  const cleaned = (path.startsWith('/') ? '/' : '') + segments.join('/');
  return cleaned === '' ? '.' : cleaned;
}

function member(value: Json | undefined, key: string): Json | undefined {
  return value instanceof Map ? value.get(key) : undefined;
}

// Every top-level EXPLAIN result in psql's output: a JSON array whose first
// item has a "Plan". Other text, such as command tags, is skipped.
function explainResults(output: string): Map<string, Json>[] {
  const plans: Map<string, Json>[] = [];
  let position = 0;

  while (true) {
    const start = output.indexOf('[', position);
    if (start < 0) {
      return plans;
    }

    const decoded = decodeJsonAt(output, start);
    if (!decoded) {
      position = start + 1;
      continue;
    }

    const first = Array.isArray(decoded.value) ? decoded.value[0] : undefined;
    if (first instanceof Map && first.has('Plan')) {
      plans.push(first);
    }
    position = decoded.end;
  }
}

function required(value: Json | undefined, name: string): Json {
  if (value === undefined) {
    throw new ProofError(`the plan has no ${JSON.stringify(name)}`);
  }

  return value;
}

function main(): void {
  const { values, positionals } = parseCommandLine(HELP, {
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string' },
    user: { type: 'string' },
    'maintenance-db': { type: 'string', default: 'postgres' },
    suffix: { type: 'string', default: timestampSuffix() },
    output: { type: 'string' },
  });
  if (positionals.length > 0) {
    usageError(HELP, `unrecognized arguments: ${positionals.join(' ')}`);
  }
  if (values.port === undefined || values.user === undefined) {
    const missing = [
      values.port === undefined ? '--port' : '',
      values.user === undefined ? '--user' : '',
    ].filter((name) => name !== '');
    usageError(
      HELP,
      `the following arguments are required: ${missing.join(', ')}`
    );
  }
  if (!HOSTS.includes(values.host)) {
    usageError(
      HELP,
      `argument --host: invalid choice: '${values.host}' (choose from ${HOSTS.join(', ')})`
    );
  }
  if (!/^\s*[+-]?\d+(_\d+)*\s*$/.test(values.port)) {
    usageError(HELP, `argument --port: invalid int value: '${values.port}'`);
  }

  const port = Number(values.port.replaceAll('_', ''));
  const suffix = values.suffix;
  if (port < 1 || port > 65535 || !/^[a-z0-9_]{1,30}$/.test(suffix)) {
    usageError(
      HELP,
      'port must be valid and suffix must be 1-30 lowercase letters, digits or underscores'
    );
  }

  const psql = Bun.which('psql');
  if (psql === null) {
    usageError(
      HELP,
      "psql must be on PATH (run inside the repository's Nix environment)"
    );
  }

  const psqlPath: string = psql;
  const out = cleanPath(values.output ?? `/tmp/channel-change-plans-${suffix}`);
  if (existsSync(out)) {
    throw new ProofError(`the output directory already exists: ${out}`);
  }
  mkdirSync(out, { recursive: true });

  const host = values.host === '::1' ? '[::1]' : values.host;
  const url = `postgresql://${quote(values.user)}@${host}:${port}/`;

  function run(database: string, sql: string): string {
    const result = spawnSync(
      psqlPath,
      [url + quote(database), '-X', '-v', 'ON_ERROR_STOP=1', '-At'],
      { input: sql, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 }
    );
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new ProofError(strip(result.stderr));
    }

    return result.stdout.replace(/\r\n?/g, '\n');
  }

  const queries = buildQueries();
  const smallSeed = SEED.replaceAll(
    'generate_series(20,29)',
    'generate_series(20,20)'
  )
    .replaceAll('generate_series(1,1000000)', 'generate_series(1,10)')
    .replaceAll('100000 FROM generate_series', '10 FROM generate_series');
  const seed = SEED + SUPPLEMENTAL_SEED;
  writeFileSync(`${out}/seed.sql`, seed);

  for (const { name, types, sql, params } of queries) {
    writeFileSync(
      `${out}/${name}.sql`,
      `PREPARE ${name}(${types}) AS\n${sql};\nEXECUTE ${name}(${params});\n`
    );
  }

  const maintenance = values['maintenance-db'];
  const summary: Json[] = [];

  for (const stats of ['fresh', 'stale']) {
    const database = `channel_change_proof_${suffix}${stats === 'stale' ? '_stale' : ''}`;
    const existing = run(
      maintenance,
      `SELECT 1 FROM pg_database WHERE datname='${database}';`
    );
    if (strip(existing) !== '') {
      throw new ProofError(`Refusing to reuse existing database: ${database}`);
    }

    run(maintenance, `CREATE DATABASE ${database} TEMPLATE template1;`);
    console.log('Created', database);

    if (stats === 'stale') {
      // Statistics describe ten rows per table while the tables hold millions.
      const freeze = TABLES.map(
        (table) => `ALTER TABLE ${table} SET (autovacuum_enabled=false);`
      );
      run(database, smallSeed);
      run(database, `ANALYZE;${freeze.join('')}`);
      run(database, seed);
      run(
        database,
        "UPDATE channel_change_counters SET seq=100000 WHERE channel_id BETWEEN '00000000-0000-0000-0000-000000000014' AND '00000000-0000-0000-0000-00000000001d';"
      );
    } else {
      run(database, seed);
      run(database, 'ANALYZE;');
    }

    const counts = TABLES.map(
      (table) => `SELECT '${table}', count(*) FROM ${table};`
    );
    writeFileSync(
      `${out}/${stats}_sizes.txt`,
      run(database, `SHOW server_version;${counts.join('')}`)
    );

    for (const { name, types, sql, params } of queries) {
      for (const mode of ['custom', 'generic']) {
        // Each statement is planned and executed twice in one session.
        const explain = `BEGIN;\nEXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) EXECUTE q(${params});\nROLLBACK;\n`;
        const output = run(
          database,
          `${SETTINGS}SET plan_cache_mode=force_${mode}_plan;\nPREPARE q(${types}) AS\n${sql};\n${explain}${explain}`
        );
        writeFileSync(`${out}/${stats}_${name}_${mode}.json.txt`, output);

        const timings: string[] = [];
        for (const [index, result] of explainResults(output).entries()) {
          const plan = required(result.get('Plan'), 'Plan');
          const ms = required(result.get('Execution Time'), 'Execution Time');
          const hits = member(plan, 'Shared Hit Blocks') ?? 0n;
          const reads = member(plan, 'Shared Read Blocks') ?? 0n;
          summary.push(
            new Map<string, Json>([
              ['stats', stats],
              ['query', name],
              ['mode', mode],
              ['run', BigInt(index + 1)],
              ['ms', ms],
              ['hits', hits],
              ['reads', reads],
              ['plan', plan],
            ])
          );
          timings.push(
            `(${numberText(ms)}, ${numberText(hits)}, ${numberText(reads)})`
          );
        }

        writeFileSync(`${out}/summary.json`, encodeJson(summary));
        console.log(stats, name, mode, `[${timings.join(', ')}]`);
      }
    }
  }

  console.log(
    'Complete:',
    out,
    '(disposable databases left for inspection)'
  );
}

runProof(main);
