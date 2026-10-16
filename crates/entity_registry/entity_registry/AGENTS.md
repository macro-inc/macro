# entity_registry

## What it is

Shared infrastructure used across every owned-entity feature: the owning
crate for the `entity` table, recording one owner per in-scope resource,
plus the owner-grant policy for what access that owner implies.

## Start here

- `src/lib.rs`: crate-level doc comment explains the split with
  `entity_registry_db_utils` and `shared_entity_registry` — read it first.
- `src/domain/service.rs` + `src/domain/ports.rs`: `EntityRegistryService` /
  `EntityRegistryRepository` (reads).
- `src/domain/owner_grant_policy.rs`: `OwnerGrantPolicy` — which access
  grants a given owner type implies.
- `src/domain/creation_principal.rs`: resolving who gets recorded as creator
  vs. owner (bots vs. users).
- `src/outbound/pg_entity_registry_repo.rs`: the Postgres adapter (feature
  `postgres`).

## Scope

- Owns: reads of the `entity` table and the owner-grant policy.
- Not here: effective access (who can view/edit) → `crates/entity_access`;
  transactional writes → `crates/entity_registry/entity_registry_db_utils`;
  shared types (`NewEntityRecord`, `Owner`, errors) →
  `crates/entity_registry/shared_entity_registry`.

## Boundaries

- Depends on: `shared_entity_registry`, `model-entity`, `model_owner`,
  `macro_authorization` (feature `axum`), `bot_id`.
- Used by: `crates/memory`, `crates/ai_tools`, `crates/projects`,
  `crates/agent_harness`, `crates/teams`, `crates/agent_session`,
  `crates/chat`, `crates/documents`, `crates/bots`,
  `crates/document_storage_service_client`, and most services that create
  owned entities.

## Recipes

- Add an ownable entity type: `shared_entity_registry` (`RegisteredEntityType`)
  → `src/domain/owner_grant_policy.rs` (grants for the new type) →
  `entity_registry_db_utils` (callers register rows there).

## Checks

- `cargo test -p entity_registry` (`SQLX_OFFLINE` unset; requires local
  MacroDB — `just setup_macrodb`).

## Related

- Rules: `.agents/rules/rust/architecture.md` · Crate:
  `crates/entity_registry/entity_registry_db_utils`
