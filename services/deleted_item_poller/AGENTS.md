# deleted_item_poller

## What it is

Shared infrastructure: EventBridge-scheduled Lambda that sweeps users'
deleted items (chats, documents, projects) older than 30 days and queues
them for permanent deletion.

## Start here

- `src/handler.rs`: runs `handle_chats`, `handle_documents`, `handle_projects`
  concurrently via `tokio::join!`, so one kind's failure does not cancel the
  others; each publishes purge events through `MacroEventBroker`, then queues
  deletion (chats, documents) or deletes directly (projects).
- `src/context.rs`: DB pool + event broker + queue clients.

## Scope

- Owns: finding items past the retention window and triggering their deletion
  across chats, documents, and projects.
- Not here: the actual permanent deletion of a chat →
  `services/delete_chat_handler` (consumes the event this lambda publishes);
  of a document → the delete document worker in
  `services/document_storage_service` (consumes the document delete queue).

## Recipes

- Add a new deletable entity type: `src/handler.rs` (new `handle_<entity>`
  joined into the `join!`) → its domain crate's purge event type → a
  consumer lambda/worker. A kind whose trash can grow to millions follows
  `purge_expired_documents`: a keyset page over an index on the trash time and
  a per-run cap.
- Change the retention window: the 30-day cutoff each `handle_<entity>`
  computes in `src/handler.rs`.

## Gotchas

- Documents are purged at most `DOCUMENT_PURGE_LIMITS.run_cap` per run, in
  pages read through `idx_document_deleted_at_id`; a larger backlog drains over
  later runs. A document stays in trash until the delete worker removes it, so
  a cap above what that worker clears in four hours makes the next run queue
  the same documents again; the repeats fail in the worker and go to its
  dead-letter queue.
- A document is queued for deletion only after its purge event is delivered.
  Whatever fails stays in trash for the next run; a repeated purge event only
  removes the document from search again.
- Lambda does not retry a failed run (`maximumRetryAttempts: 0` in
  `infra/stacks/deleted-item-poller/lambda.ts`): a retry would queue the
  documents the failed run had already queued. The next scheduled run picks up
  the rest.
- The Lambda has no trace exporter, so the run's span fields reach Datadog only
  on the `expired document purge run finished` log line.

## Checks

- `cargo test -p deleted_item_poller` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/db.md`
