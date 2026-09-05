import { SQL, randomUUIDv7 } from 'bun';
import { parseArgs } from 'node:util';

export const PREPARE_VERSION = '20260904222458';
export const CUTOVER_VERSION = '20260904223029';
const migrations = new URL('../../crates/macro_db_client/migrations/', import.meta.url).pathname;

export async function migrateDatabase(target: string) {
  const process = Bun.spawn(['sqlx', 'migrate', 'run', '--source', migrations, '--target-version', target], {
    stdout: 'inherit', stderr: 'inherit',
  });
  if (await process.exited !== 0) throw new Error('SQLx migration failed');
}

/** Stable mappings are allocated once, including structural roots for empty threads. */
export async function allocateMappings(db: SQL) {
  await db.begin(async (tx) => {
    await tx`LOCK TABLE "Comment", "Thread" IN SHARE ROW EXCLUSIVE MODE`;
    const ambiguous = await tx`
      SELECT t.id::text FROM "Thread" t
      LEFT JOIN "PdfPlaceableCommentAnchor" p ON p."threadId" = t.id
      LEFT JOIN "PdfHighlightAnchor" h ON h."threadId" = t.id
      GROUP BY t.id HAVING count(DISTINCT p.uuid) + count(DISTINCT h.uuid) > 1`;
    if (ambiguous.length) throw new Error(`Multiple PDF anchors on legacy threads: ${ambiguous.map((r) => r.id).join(', ')}`);
    const comments = await tx`
      SELECT c.id::text, t."documentId" AS document_id FROM "Comment" c
      JOIN "Thread" t ON t.id = c."threadId" ORDER BY c.id`;
    for (const comment of comments) {
      await tx`INSERT INTO migrated_comment_id (comment_id, message_id, document_id)
        VALUES (${comment.id}::bigint, ${randomUUIDv7()}::uuid, ${comment.document_id})
        ON CONFLICT (comment_id) DO NOTHING`;
    }
    const threads = await tx`
      SELECT t.id::text, t."documentId" AS document_id, first.message_id::text AS first_message_id
      FROM "Thread" t LEFT JOIN LATERAL (
        SELECT m.message_id FROM "Comment" c JOIN migrated_comment_id m ON m.comment_id = c.id
        WHERE c."threadId" = t.id ORDER BY c."order" NULLS LAST, c."createdAt", c.id LIMIT 1
      ) first ON true ORDER BY t.id`;
    for (const thread of threads) {
      await tx`INSERT INTO migrated_comment_thread_id (thread_id, root_id, document_id)
        VALUES (${thread.id}::bigint, ${thread.first_message_id ?? randomUUIDv7()}::uuid, ${thread.document_id})
        ON CONFLICT (thread_id) DO NOTHING`;
    }
    const wrongRoots = await tx`
      SELECT t.id FROM "Thread" t JOIN migrated_comment_thread_id m ON m.thread_id = t.id
      JOIN LATERAL (
        SELECT cm.message_id FROM "Comment" c JOIN migrated_comment_id cm ON cm.comment_id = c.id
        WHERE c."threadId" = t.id ORDER BY c."order" NULLS LAST, c."createdAt", c.id LIMIT 1
      ) first ON true WHERE m.document_id <> t."documentId" OR m.root_id <> first.message_id`;
    if (wrongRoots.length) throw new Error('Legacy data changed after UUID allocation; keep writers paused');
  });
}

async function main() {
  const { values, positionals } = parseArgs({ args: Bun.argv.slice(2), allowPositionals: true, options: {
    'writers-paused': { type: 'boolean' },
  } });
  const [command] = positionals;
  if (!['prepare', 'finish'].includes(command ?? '')) {
    throw new Error('Usage: bun scripts/message-cutover/run.ts prepare|finish --writers-paused');
  }
  if (!values['writers-paused']) throw new Error('Pause old application writers first; --writers-paused records the operator confirmation');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Load DATABASE_URL from the existing deployment secret configuration');
  const db = new SQL(databaseUrl);
  const lock = await db.reserve();
  try {
    const [result] = await lock`SELECT pg_try_advisory_lock(732847201) AS acquired`;
    if (!result.acquired) throw new Error('Another message cutover command is running');
    const [ledger] = await db`SELECT to_regclass('_sqlx_migrations') IS NOT NULL AS exists`;
    if (ledger.exists) {
      const [completed] = await db`SELECT EXISTS (SELECT 1 FROM _sqlx_migrations WHERE version = ${CUTOVER_VERSION}::bigint AND success) AS done`;
      if (completed.done) { console.log('Message cutover already completed'); return; }
    }
    if (command === 'prepare') {
      await migrateDatabase(PREPARE_VERSION);
      await allocateMappings(db);
    } else {
      await allocateMappings(db);
      await migrateDatabase(CUTOVER_VERSION);
    }
  } finally {
    await lock`SELECT pg_advisory_unlock(732847201)`;
    lock.release();
    await db.close();
  }
}

if (import.meta.main) await main();
