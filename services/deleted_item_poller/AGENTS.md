# deleted_item_poller

## What it is

Shared infrastructure: EventBridge-scheduled Lambda that sweeps users'
deleted items (chats, documents, projects) older than 30 days and queues
them for permanent deletion.

## Start here

- `src/handler.rs`: runs `handle_chats`, `handle_documents`, `handle_projects`
  concurrently via `tokio::try_join!`; each publishes purge events through
  `MacroEventBroker` (chats/documents) or queues deletion directly (projects).
- `src/context.rs`: DB pool + event broker + queue clients.

## Scope

- Owns: finding items past the retention window and triggering their deletion
  across chats, documents, and projects.
- Not here: the actual permanent deletion of a chat →
  `services/delete_chat_handler` (consumes the event this lambda publishes).

## Recipes

- Add a new deletable entity type: `src/handler.rs` (new `handle_<entity>`
  joined into the `try_join!`) → its domain crate's purge event type → a
  consumer lambda/worker.
- Change the retention window: the domain crate's query
  (`documents`/`chat`/`projects`), not this lambda.

## Checks

- `cargo test -p deleted_item_poller` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/db.md`
