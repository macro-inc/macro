# entity_access

## What it is

Shared infrastructure used across nearly every feature: entity access
control for cloud storage, checking a user's or bot's access level to any
entity (documents, chats, projects, and more). One of the most widely
depended-on crates in the backend.

## Start here

- `src/domain/service.rs` + `src/domain/ports.rs`: `EntityAccessService` and
  the `AccessRepository` trait it's built on — one `get_<entity>_access`
  method per entity kind.
- `src/domain/models.rs`: `AccessLevel`, `RequiredPermission`; its
  `receipt.rs` holds `EntityAccessReceipt` — the typed receipt proving a
  checked access level.
- `src/inbound/axum_extractors.rs`: Axum extractors that resolve a receipt
  from the request (feature `inbound`).
- `src/outbound/pg_access_repo.rs`: the Postgres adapter (feature `outbound`).
  Form Edit/Owner grants Edit on the backing database; form View grants
  database View only when that form shares its responses.
- `src/bin/explain_access.rs`: CLI to explain why a user has (or lacks)
  access to an entity (feature `explain_binary`).

## Scope

- Owns: read-side access-level checks and their `EntityAccessReceipt` proof
  type.
- Not here: writing/propagating access grants (project moves, sharing
  updates) → `crates/entity_access_management`; the raw `entity_access` table
  queries → `crates/entity_access_db_utils`.

## Boundaries

- Depends on: `model-entity`, `model_owner`, `models_entity_access_management`,
  `models_permissions`, `macro_user_id`, `bot_id`.
- Used by: nearly every domain crate that authorizes a request (`documents`,
  `chat`, `projects`, `crm`, `forms`, `databases`, `channels`, `agent_session`,
  `graphql_*` crates, and most services) — a signature change here ripples
  widely; check callers first.

## Recipes

- Add an entity kind's access check: `src/domain/ports.rs`
  (`AccessRepository` method) → `src/domain/service.rs` → `src/outbound/pg_access_repo.rs`.
- Debug a specific grant: `cargo run -p entity_access --bin explain_access
  --features explain_binary`.

## Checks

- `cargo test -p entity_access` (`SQLX_OFFLINE` unset; requires local
  MacroDB — `just setup_macrodb`).

The message sender extractor maps signed user `agent_id` attribution to a bot
receipt scoped to that same user and organization only for new posts. Reads,
edits, deletes, and reactions keep the caller identity; access policy remains in
the entity-access domain service.

## Gotchas

- `#![deny(missing_docs)]`.
- `EntityAccessReceipt<R: RequiredPermission>` is the only proof a caller
  checked access at the right level; domain code downstream (e.g.
  `entity_mutation`) takes a receipt, not a raw boolean/level.
- A receipt whose auth is `Unauthenticated` never holds more than View. Its
  fields are private to `src/domain/models/receipt.rs`, and its constructors
  enforce the ceiling, so a caller with no account who presents a Comment,
  Edit, or Owner public grant gets View on View routes and 401 on anything
  stronger. Build receipts with `try_new_for_user` (signed in or not),
  `try_new_authenticated_user`, `try_new_bot`, or `try_new`; never add a
  constructor that takes an `EntityAccessAuth` without going through `try_new`.

- `get_user_source_ids` is cached for 10 s per process and concurrent misses
  for one user share one query through `single_flight`. A failure then arrives
  as `Arc<sqlx::Error>`; `anyhow_access_error` classifies both forms, so route
  new callers' errors through it.
- `ExternalChat` resolves ordinary entity-access/link/team grants through `external_chat_access_level`; its extractor reads `chat_id`.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/security.md`
  · Skill: `cloud-storage-hexagonal-architecture`
