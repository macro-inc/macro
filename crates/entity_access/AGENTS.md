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
- `src/domain/models.rs`: `AccessLevel`, `RequiredPermission`,
  `EntityAccessReceipt` — the typed receipt proving a checked access level.
- `src/inbound/axum_extractors.rs`: Axum extractors that resolve a receipt
  from the request (feature `inbound`).
- `src/outbound/pg_access_repo.rs`: the Postgres adapter (feature `outbound`).
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

- Document checks fall back to live calendar-note or optional team grants only
  when ordinary document access is absent; these grants are authenticated and
  view-only. Keep the shared SQL visibility policy aligned with calendar note reads.
- `#![deny(missing_docs)]`.
- `EntityAccessReceipt<R: RequiredPermission>` is the only proof a caller
  checked access at the right level; domain code downstream (e.g.
  `entity_mutation`) takes a receipt, not a raw boolean/level.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/security.md`
  · Skill: `cloud-storage-hexagonal-architecture`
