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
- The Postgres adapter and the `explain_access` CLI live in
  `crates/entities/entity_access_outbound`.

## Scope

- Owns: read-side access-level checks and their `EntityAccessReceipt` proof
  type.
- Not here: writing/propagating access grants (project moves, sharing
  updates) → `crates/entities/entity_access_management`; the raw `entity_access` table
  queries → `crates/entities/entity_access_db_utils`.

## Boundaries

- Depends on: `model_entity`, `model_owner`, `models_entity_access_management`,
  `models_permissions`, `macro_user_id`, `bot_id`.
- Used by: nearly every domain crate that authorizes a request (`documents`,
  `chat`, `projects`, `crm`, `forms`, `databases`, `channels`, `agent_session`,
  `graphql_*` crates, and most services) — a signature change here ripples
  widely; check callers first.

## Recipes

- Add an entity kind's access check: `src/domain/ports.rs`
  (`AccessRepository` method) → `src/domain/service.rs` →
  `entity_access_outbound`'s `src/pg_access_repo.rs`.
  If its users are exactly its `entity_access` grants, also list it in
  `GRANT_AUDIENCE_KINDS` (`src/domain/service.rs`) so bulk lookups group it; otherwise
  it falls back to one lookup per entity.
- Depend on `entity_access_outbound` only where you construct
  `PgAccessRepository` (composition roots, and tests as a dev-dependency);
  domain crates take the `AccessRepository`/`EntityAccessService` ports.

## Checks

- `cargo test -p entity_access`; the database tests are in
  `entity_access_outbound`.

The message sender extractor maps signed user `agent_id` attribution to a bot
receipt scoped to that same user and organization only for new posts. Reads,
edits, deletes, and reactions keep the caller identity; access policy remains in
the entity-access domain service.

## Gotchas

- `#![deny(missing_docs)]`.
- `EntityAccessReceipt<R: RequiredPermission>` is the only proof a caller
  checked access at the right level; domain code downstream (e.g.
  `entity_mutation`) takes a receipt, not a raw boolean/level.
- Spans here never record a user id (a `MacroUserId` is an email): skip it.
  Checks record how many source ids they bound as `source_id_count`, through
  `user_source_ids` in `entity_access_outbound` and `domain::telemetry`; a caller
  wraps its checks in `observe_source_ids` to record the count on its own span,
  as `initiative.read` does. A new check that fetches source ids goes through
  `user_source_ids` so its span gets the count.
- `ExternalChat` resolves ordinary entity-access/link/team grants through `external_chat_access_level`; its extractor reads `chat_id`.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/security.md`
  · Skill: `cloud-storage-hexagonal-architecture`

- CRM company/contact receipts and audiences require current `team_user.crm_access` or an admin/owner role. Single, list and batched pipeline reads resolve fresh sharing sources so CRM denial removes only team grants; direct and channel grants remain. The email thread requester check is separate from contributor consent.
- Source and grant lookups used by live activity checks have a local 15-second statement timeout. Keep team-bot company/contact lookups fenced by record ID before filtering team ownership; stale statistics otherwise favor team-wide scans.
- Keep fresh pipeline channel-source lookups parameterized through the fenced viewer row; stale statistics can otherwise choose a scan of all channel memberships.
