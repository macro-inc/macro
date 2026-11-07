# foreign_entity

## What it is

Shared infrastructure used across many product features (GitHub PRs, Soup,
documents, memory, AI tools): generic CRUD storage for records sourced from a
third-party system, following the hexagonal architecture pattern.

## Start here

- `src/domain/models.rs`: `ForeignEntity`, `SourceId`, and the create/patch
  shapes.
- `src/domain/ports.rs` + `src/domain/service.rs`: the service and its
  listing/query port.
- `src/outbound/pg_foreign_entity_repo.rs`: the Postgres adapter.

## Scope

- Owns: the generic foreign-entity row (source id, owning entity, payload)
  and its listing/filter query.
- Not here: what a specific foreign entity's payload means (e.g. pull request
  fields) → `crates/github_pull_requests`, which stores its typed columns on
  top of this crate's rows.

## Boundaries

- Depends on: `entity_access` (ports), `item_filters`, `models_pagination`.
- Used by: `github_pull_requests`, `github`, `soup`, `documents`, `memory`,
  `ai_tools`, `document_storage_service`, `document_cognition_service`,
  `authentication_service`, `mcp_service`.

## Recipes

- Add a new foreign entity source: the owning domain crate stores its typed
  columns through `src/domain/ports.rs` → `src/outbound/pg_foreign_entity_repo.rs`
  (shared query/listing logic lives here, not per-source).

## Checks

- `cargo test -p foreign_entity --all-features` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`
