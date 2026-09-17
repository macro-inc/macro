# Legacy comment import

Moves the historical document comments in `"Comment"` / `"Thread"` into the
shared message store (`comms_messages`, `comms_message_threads`) while the
application keeps running. Nothing is dropped; the legacy tables and endpoints
go away in the last PR of the channel and comment unification stack.

## Operating model

The importer is a projection: each run recomputes what every legacy thread and
comment should look like in the message store and writes only the rows whose
projection differs. That gives three properties operators rely on:

- **Re-runnable.** A second run without legacy changes prints
  `Nothing to import` and writes nothing. Ids never change between runs: every
  comment and thread gets one UUIDv7 in `migrated_comment_id` /
  `migrated_comment_thread_id` on its first sighting and keeps it.
- **Delta-aware.** Comments created, edited, or deleted (soft or hard) through
  the legacy endpoints after a run are picked up by the next run. New comments
  get mappings; changed ones are compared by text, timestamps, and deletion.
- **Live.** Work happens in one transaction per batch of documents (250 by
  default). Each batch takes a `SHARE ROW EXCLUSIVE` lock on `"Comment"` and
  `"Thread"` for the duration of that transaction, so legacy comment writes
  wait for at most one batch; they are never rejected. Reads are unaffected.
  The lock waits at most five seconds for in-flight writers and the batch is
  retried. Nothing takes `ACCESS EXCLUSIVE`.

Two runs cannot overlap: a session advisory lock makes the second exit with
`Another comment import is running`.

### Sequence

1. Run the importer as often as you like while legacy writes continue.
   Each run reports what it wrote and what it could not represent.
2. Before enabling the new document discussion UI, freeze legacy comment
   writes: set `LEGACY_COMMENT_WRITES_ENABLED=false` on the document storage
   service (Doppler project `cloud-storage-service`) and roll it out. Comment
   create, edit, and delete and anchor delete then answer `503` with
   `Document comments are read-only while they move to the new message store. Refresh the app in a few minutes and try again.`.
   Reads, highlight creation, and anchor edits keep working.
3. Run the importer once more. It must end with `Nothing to import` on a
   second invocation.
4. Enable the new UI. Do not run the importer again after that unless legacy
   writes are frozen; an edit made through the new API is never reverted by a
   stale legacy row (newer `updated_at` wins), but a legacy write and a new
   store write on the same thread while both are live is a race.

## Running it

Build from the repository root; the binary is feature gated so it never ships
with a service:

```sh
cargo build -p macro_db_migrator --features comment-import --bin comment_import
```

Point `DATABASE_URL` at the target. For RDS use the existing helper and never
the repository's local database recipes:

```sh
export DATABASE_URL="$(tooling/scripts/rds_database_url.sh <rds_identifier> <secret_name> <db_name>)"
cargo run -p macro_db_migrator --features comment-import --bin comment_import -- --check
cargo run -p macro_db_migrator --features comment-import --bin comment_import
cargo run -p macro_db_migrator --features comment-import --bin comment_import -- --documents-per-batch 50
```

`--check` runs the preflight and prints how many comments and threads still
lack a mapping without writing. Edits and deletions of already imported
comments are only detected by a real run.

## What a run writes

- `migrated_comment_id` / `migrated_comment_thread_id`: one row per legacy
  comment and thread. Roots follow legacy display `order`, then `createdAt`,
  then id, including deleted roots. An empty thread gets a fresh root id.
- `comms_messages`: one row per comment with `parent_entity_type = 'document'`,
  the thread's root as `thread_id`, `sender_id` from `owner`, `imported_author`
  from `sender`, `import_metadata` from the comment metadata, and
  `import_order` from the legacy order. A deleted root stays a tombstone with
  its replies intact. An empty thread gets an empty, deleted structural root.
- `comms_message_threads`: resolution, legacy metadata, and the anchor:
  `pdf_placeable` when a placeable anchor points at the thread, else
  `pdf_highlight` for a live highlight, else `markdown` when the thread's
  `markId` is a UUID. `DISCUSSION:` marks, missing marks, and marks that are
  not UUIDs land unanchored. Threads with no comments are marked deleted, so
  the new UI never shows an empty "This message was deleted." discussion.
- `"PdfPlaceableCommentAnchor".root_id` / `"PdfHighlightAnchor".root_id` from
  the thread mapping; the legacy `"threadId"` stays until the contract PR.
- `notification.metadata` `commentId` / `threadId` for
  `commented_on_document`, `replied_to_document_comment_thread`, and
  `mentioned_in_document_comment` rows on the batch's documents.
- Numeric `comments[].id` values inside saved PDF
  `"DocumentInstanceModificationData"` payloads.

Rows written through the message store after import are protected: a legacy
row only overwrites a message or thread state when it is at least as new as the
stored `updated_at`. Legacy deletions do not bump `updatedAt`, so they still
apply.

## Preflight failures

The run stops before writing when the legacy data cannot be represented:

- A live thread with more than one PDF anchor. Detach or delete one.
- Two live legacy threads with comments sharing the same Markdown mark on one
  document. Delete the duplicate; the message store allows one active
  discussion per mark.

A batch that fails for another reason (for example a discussion created through
the new API already owns a legacy thread's mark) rolls back that batch alone.
Earlier batches stay committed and the failed one is retried on the next run.

## Warnings

Warnings are reported and never abort a run:

- notifications whose `commentId` or `threadId` has no mapping (the comment was
  removed before the import existed); they keep their legacy ids.
- numeric PDF comment ids without a mapping; they are left as they are.
- threads whose mark is neither a UUID nor a `DISCUSSION:` mark; imported
  unanchored.
- threads whose first legacy comment is no longer the mapped root; roots are
  fixed at first import, later comments are replies.

## Tests

From the repository root with `SQLX_OFFLINE` unset and local Postgres running:

```sh
cargo test -p macro_db_migrator --features comment-import
```

The suite seeds the legacy tables on the current schema and covers roots,
replies, deleted roots, empty threads, Markdown and PDF anchors, notification
and PDF payload remaps, the no-op second run, delta runs, protection of newer
message store writes, tombstones for removed legacy rows, concurrent runners,
preflight aborts, rollback of a failed batch, mapping batches beyond 1,000 rows,
and the parent-scoped index plans for channel reads.
