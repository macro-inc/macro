# Entity message cutover

This is a coordinated database cutover in one release. The old and new application
versions must not write concurrently. There is no dual-write mode or comment
compatibility store.

Existing Markdown documents, Loro snapshots, operation history, and node IDs are
not rewritten. New ReplyTarget references can serialize a document or channel parent
(editor format 3.1); older references are canonicalized on read. This requires no
snapshot or history migration. A comment mark's stable `ids` entry matches the new thread's
`anchor.mark_id`; the editor ignores the old redundant numeric `threadId` field.
The migration copies that mark ID from the old Thread metadata into thread state.

## Before the release

1. Build and validate the new backend, frontend, GraphQL schema, and generated
   clients together. Rehearse these commands against a restored production database.
2. Take a recoverable database snapshot. Keep the previous deployment artifacts.
   Record source counts for Comment, Thread, PDF anchors, and notifications.
3. Pause document/comment/channel writers and drain their in-flight requests,
   background jobs, and notification delivery. Drain old `macro.agent_triggers`
   events before replacing their consumers: the generic thread trigger payload is
   schema version 2 and replaces the channel-only payload. Provision `macro.messages`
   from the generated Kafka topic registry, and deploy all agent-trigger, harness,
   coding-worker, and webhook consumers with the matching producer.
   Require clients to refresh for the
   new API before reopening writes. No document-content migration runs during this pause.
4. Check for legacy threads with more than one PDF anchor or multiple active
   threads using the same document/Markdown mark. Resolve ambiguities before
   cutover. Missing mappings in saved PDF metadata or historical notifications
   abort the final transaction rather than dropping the references.

Load the target's existing `DATABASE_URL` securely. Do not use the repository's
hardcoded local database recipes against a deployment database. Run from the root:

```sh
cargo run -p macro_db_migrator --features message-cutover --bin message_cutover -- prepare --writers-paused
cargo run -p macro_db_migrator --features message-cutover --bin message_cutover -- finish --writers-paused
```

The Rust binary uses the embedded `MACRO_DB_MIGRATIONS` and `macro_uuid`; it does
not require Bun, a separate SQLx executable, or migration files at runtime. Build
the binary before the release pause. UUID mappings are allocated in batches of
1,000 inside a transaction, rather than loading all comments into memory.

`prepare` runs migration 20260904222458 and allocates UUIDv7 mappings. Retrying keeps
the same IDs. Roots are selected by old display order, then creation time and old
ID, including deleted roots. Empty threads receive structural tombstones.

`finish` revalidates the mappings and runs migration 20260904223029. One transaction
imports comments and thread state, converts PDF anchor foreign keys, rewrites
saved PDF export comment IDs and notification IDs, verifies counts and content,
and drops Comment, Thread, ThreadAnchor, and the channel_id storage columns.
The two `comms_channel_*` views are filtered reads of the sole message store.
The immutable ID mapping tables only resolve previously copied links.

Both commands take the same advisory lock. They report success without rewriting
anything if the final migration is already recorded as complete. The command's
`--writers-paused` flag records an operator assertion; it does not pause services.

Run the database regression tests from the repository root, with `SQLX_OFFLINE`
unset and the existing local test database available:

```sh
cargo test -p macro_db_migrator --features message-cutover
```

Tests seed isolated databases on the schema before either migration. They cover
deleted roots, replies, empty threads, Markdown mark IDs, PDF placeable/highlight
anchors and geometry, saved PDF metadata, notifications, post-cutover writes,
mapping batches, retries, concurrent runners, and rollback of a failed final step.
They do not constitute a browser or Loro-document migration rehearsal.

## Verification and reopening

Deploy the matching backend and frontend with writes still paused. Check:

- Original Comment count equals the migrated message mapping count, and original
  Thread count equals the migrated thread mapping count. Empty roots are additional
  message rows, not comments lost during conversion.
- A copied numeric comment link opens the same document discussion under current
  access checks. UUID links open roots and replies.
- Old Markdown highlights still open their discussions, including after opening
  an older document version. A new mark stores its mark ID and draft state only.
- PDF highlights, placeables, resolution, imported attribution, and export geometry
  survive. Deleting one root preserves replies; deleting the discussion removes its
  comment placeable and preserves an otherwise independent highlight.
- Two browser sessions see posts, edits, reactions, and typing. Comments generate
  contextual document comment notifications.
- Channels retain their normal notifications, bot triggers, attachments, and search.
- `@Macro` in a document comment posts its answer into that discussion. Session
  agents open a session linked to the document thread; follow-up mentions reach
  that session. Revoking document access blocks new prompts and reply delivery.
- `Include channel mentions` shows only channels the viewer can currently read.
  Replies and copied links retain their source channel, and revocation removes the
  source from the next refresh. No source mention grants document or channel access.

Message persistence commits before delivery. Realtime and broker delivery failures
are logged without returning a misleading write failure to the caller. This release
does not add a durable outbox: a broker failure can miss an agent trigger, and clients
reconcile transient UI updates by refetching. Do not assume exactly-once dispatch.

Reopen writers only after the smoke checks pass and old clients have refreshed.

## Failure and rollback

A failed final SQL migration rolls back all of its changes. Keep writers paused,
correct the reported preflight/data issue, and rerun `finish`; the prepared mappings
stay stable. There is no sync-service checkpoint to recover.

After a successful cutover, reverting just the application would put old writers
against the new schema. To roll back, keep writes paused and restore the database
snapshot and previous application artifacts together. If new writes have already
been accepted, capture them before restoration; restoring the snapshot alone
would discard those writes. Never run old comment writers against the new store.
