# delete_chat_handler

## What it is

Chat feature: SQS-triggered Lambda that permanently deletes a chat once it
has been marked deleted.

## Start here

- `src/handler.rs`: reads the `chat_id` SQS message attribute, checks
  `is_chat_deleted`, then calls `delete_chat`. Expects exactly one record per
  invocation (queue is configured for batch size 1).
- `src/service/db/`: `delete_chat.rs` and `get_chat.rs` — the only DB queries
  this lambda needs.

## Scope

- Owns: the final, permanent deletion of a chat already soft-deleted
  elsewhere.
- Not here: marking a chat deleted, or deleting other entity types →
  `services/deleted_item_poller` (documents/projects/chats sweep that enqueues
  this lambda).

## Recipes

- Change what deleting a chat cleans up: `src/service/db/delete_chat.rs`.

## Checks

- `cargo test -p delete_chat_handler` (`SQLX_OFFLINE` unset; requires local
  MacroDB).
- `nix develop --command just prepare_db` from the repo root after query changes (local Postgres on `localhost:5432`).

## Gotchas

- `handler.rs` hard-fails (returns `Err`) if the SQS batch doesn't contain
  exactly one record — the queue's batch size is part of this lambda's
  contract, not just an optimization.

## Related

- Rules: `.agents/rules/rust/db.md`
