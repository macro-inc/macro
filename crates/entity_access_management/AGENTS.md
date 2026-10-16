# entity_access_management

## What it is

Shared infrastructure backing entity access, mainly for the Projects
feature: manages `entity_access` row updates triggered by entity lifecycle
events — adding/removing an entity from a project, and moving a project.

## Start here

- `src/domain/ports.rs`: `EntityAccessManagementRepository` (add/remove from
  project, move project) and `EntityAccessManagementService`.
- `src/domain/service.rs`: the service implementation.
- `src/outbound/pg_repo.rs`: the Postgres adapter (feature `outbound`,
  default-on).

## Scope

- Owns: propagating project-membership changes into `entity_access` rows.
- Acquire the shared transaction guard before reading project sources or
  descendants, so propagation cannot recreate a concurrently revoked grant.
- Not here: checking access levels → `crates/entity_access`; the raw insert/
  delete helpers it calls → `crates/entity_access_db_utils`.

## Boundaries

- Depends on: `macro_user_id`, `model-entity`, `models_entity_access_management`,
  `models_permissions`, `entity_access_db_utils` (feature `outbound`).
- Used by: `crates/email`, `crates/projects`, `crates/chat`, `crates/documents`,
  `crates/macro_db_client`, `services/document_storage_service`,
  `services/email_service`.

## Recipes

- Add a lifecycle event: `src/domain/ports.rs` (repository method) →
  `src/domain/service.rs` → `src/outbound/pg_repo.rs` → a fixture under
  `fixtures/*.sql`.

## Checks

- `cargo test -p entity_access_management` (`SQLX_OFFLINE` unset; requires
  local MacroDB — `just setup_macrodb`).

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`
