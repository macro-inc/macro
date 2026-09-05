import { afterAll, beforeAll, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { allocateMappings, CUTOVER_VERSION, PREPARE_VERSION } from './run';

const name = `message_cutover_test_${crypto.randomUUID().replaceAll('-', '')}`;
const databaseUrl = new URL(process.env.DATABASE_URL ?? 'postgres://user:password@localhost:5432/macrodb');
const admin = new SQL(databaseUrl.toString());
databaseUrl.pathname = `/${name}`;
let db: SQL;

async function migrate(target: string) {
  const process = Bun.spawn(['sqlx', 'migrate', 'run', '--source', 'crates/macro_db_client/migrations', '--target-version', target], {
    env: { ...Bun.env, DATABASE_URL: databaseUrl.toString() }, stdout: 'pipe', stderr: 'pipe',
  });
  const result = await Promise.all([process.exited, new Response(process.stderr).text(), new Response(process.stdout).text()]);
  if (result[0]) throw new Error(result[1] + result[2]);
}

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${name}`);
  db = new SQL(databaseUrl.toString());
  await migrate(PREPARE_VERSION);
  await db`INSERT INTO macro_user(id, username, email, stripe_customer_id)
    VALUES ('01990000-0000-7000-8000-000000000001', 'migration', 'migration@example.com', 'migration')`;
  await db`INSERT INTO "User"(id, email, macro_user_id)
    VALUES ('macro|migration@example.com', 'migration@example.com', '01990000-0000-7000-8000-000000000001')`;
  await db`INSERT INTO "Document"(id, name, owner, "fileType")
    VALUES ('legacy-md', 'Legacy', 'macro|migration@example.com', 'md'),
      ('legacy-pdf', 'Legacy PDF', 'macro|migration@example.com', 'pdf')`;
  await db`INSERT INTO "Thread"(id, owner, "documentId", resolved, metadata) VALUES
    (1, 'macro|migration@example.com', 'legacy-md', true, '{"markId":"01990000-0000-7000-8000-000000000002"}'),
    (2, 'macro|migration@example.com', 'legacy-md', false, '{"markId":"DISCUSSION:legacy"}'),
    (3, 'macro|migration@example.com', 'legacy-pdf', false, '{}')`;
  await db`INSERT INTO "Comment"(id, "threadId", owner, sender, text, "order", "createdAt", "deletedAt") VALUES
    (10, 1, 'macro|migration@example.com', 'Original PDF author', 'Deleted root', 1, '2020-01-01', '2020-01-03'),
    (11, 1, 'macro|migration@example.com', null, 'Surviving reply', 2, '2020-01-02', null),
    (12, 3, 'macro|migration@example.com', 'PDF Author', 'PDF original', 1, '2020-01-01', null)`;
  await db`INSERT INTO "DocumentInstance"(id, "documentId", sha) VALUES (1, 'legacy-pdf', 'fixture')`;
  await db`INSERT INTO "DocumentInstanceModificationData"("documentInstanceId", "modificationData")
    VALUES (1, '{"pages":[{"highlights":[{"comments":[{"id":12,"text":"PDF original"},{"id":"external-pdf-id","text":"External"}]}]}]}')`;
  for (const kind of ['commented_on_document', 'replied_to_document_comment_thread', 'mentioned_in_document_comment']) {
    await db`INSERT INTO notification(id, notification_event_type, event_item_id, event_item_type, service_sender, metadata)
      VALUES (${crypto.randomUUID()}::uuid, ${kind}, 'legacy-md', 'document', 'dss', '{"commentId":11,"threadId":1,"commentText":"Surviving reply"}')`;
  }
}, 120_000);

afterAll(async () => {
  await db?.close();
  // This database is uniquely created above; never reset the developer's DB.
  await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.close();
});

test('populated database cutover preserves legacy identities and stable Markdown mark IDs', async () => {
  await allocateMappings(db);
  const first = await db`SELECT * FROM migrated_comment_id ORDER BY comment_id`;
  await allocateMappings(db);
  expect(await db`SELECT * FROM migrated_comment_id ORDER BY comment_id`).toEqual(first);
  await migrate(CUTOVER_VERSION);

  const messages = await db`SELECT id::text, content, thread_id::text, imported_author, deleted_at FROM comms_messages WHERE parent_entity_id = 'legacy-md' ORDER BY import_order NULLS LAST`;
  expect(messages).toHaveLength(3);
  expect(messages[0].id).toBe(first[0].message_id);
  expect(messages[0].imported_author).toBe('Original PDF author');
  expect(messages[0].deleted_at).not.toBeNull();
  expect(messages[1].thread_id).toBe(messages[0].id);
  expect(messages[1].content).toBe('Surviving reply');
  const [thread] = await db`SELECT * FROM comms_message_threads WHERE root_id = ${messages[0].id}::uuid`;
  expect(thread.resolved).toBe(true);
  expect(thread.anchor.type).toBe('markdown');
  expect(thread.anchor.mark_id).toBe('01990000-0000-7000-8000-000000000002');
  const notices = await db`SELECT metadata FROM notification`;
  expect(notices).toHaveLength(3);
  for (const notice of notices) {
    expect(notice.metadata.commentId).toBe(messages[1].id);
    expect(notice.metadata.threadId).toBe(messages[0].id);
    expect(notice.metadata.commentText).toBe('Surviving reply');
  }
  const [pdf] = await db`SELECT "modificationData" AS data FROM "DocumentInstanceModificationData"`;
  expect(pdf.data.pages[0].highlights[0].comments).toEqual([
    { id: first[2].message_id, text: 'PDF original' },
    { id: 'external-pdf-id', text: 'External' },
  ]);
  const [legacy] = await db`SELECT to_regclass('"Comment"') AS comments, to_regclass('"Thread"') AS threads`;
  expect(legacy).toEqual({ comments: null, threads: null });
  // Channel projections must never attempt to parse historical document IDs as UUIDs.
  expect(await db`SELECT id FROM comms_channel_messages WHERE channel_id = '01990000-0000-7000-8000-000000000099'::uuid`).toEqual([]);
}, 120_000);
