# comms_db_client

## What it is

Part of Chat's shared infrastructure: the query layer for channel messages,
participants, mentions, activity, and attachment references — the shared
tables behind channel/document conversations.

## Start here

- `src/lib.rs`: module list — one module per table area (`messages`,
  `channels`, `participants`, `entity_mentions`, `activity`, `attachments`).
- `src/model.rs`: the shared row types (`Message`, etc.) returned by queries.
- `src/messages/create_message.rs`: a representative `sqlx::query!` call site.

## Scope

- Owns: `sqlx::query!` call sites over `comms_messages` and related tables.
- Not here: the table schema itself, or any other MacroDB table → both live in
  `crates/macro_db_client/migrations`; comms_db_client only queries them.
- Not here: comms domain logic, authorization, or HTTP — those live in the
  callers listed below, not a dedicated comms service.

## Boundaries

- Depends on: `channels` (message event types), `model` (shared models).
- Used by: `documents`, `search_service`, and services that read/write
  channel messages (`document_storage_service`, `authentication_service`,
  `search_processing_service`), plus `tooling/seed_cli`.

## Recipes

- Add a query against an existing table: the matching `src/<area>/<verb>.rs`
  file → its sibling `test.rs` → `nix develop --command just prepare_db` from
  the repository root if `.sqlx` cache metadata is missing.
- Add a new table area: new `src/<area>.rs` module → `pub mod <area>;` in
  `src/lib.rs` → add the corresponding migration in
  `crates/macro_db_client/migrations` first (schema lives there, not here).

## Checks

- `cargo test -p comms_db_client` (`SQLX_OFFLINE` unset; requires local
  MacroDB — `just run_dbs -d` then `sqlx database setup`, per `README.md`).

## Gotchas

- This crate has no `migrations/` of its own — `comms_messages` and related
  tables are defined in `crates/macro_db_client/migrations`; keep query
  columns in sync with that schema, not the other way around.

## Related

- Rules: `.agents/rules/rust/db.md` · Docs: `docs/development/database.md`
