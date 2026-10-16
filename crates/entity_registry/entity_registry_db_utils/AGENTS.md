# entity_registry_db_utils

## What it is

Shared infrastructure used across every owned-entity feature: transactional
writes to the `entity` table, for callers to run inside their own
resource-row transaction.

## Start here

- `src/lib.rs`: `insert_entity`, `mark_deleted`, `clear_deleted`,
  `touch_updated`, `delete_entity` — plain, non-committing helpers.
- `src/owned.rs`: `OwnedEntityRegistrar` — registers an entity row and
  applies `entity_registry`'s `OwnerGrantPolicy` grants atomically (via a
  savepoint), for owned-entity creation flows.

## Scope

- Owns: `entity` table writes.
- Not here: reads → `crates/entity_registry/entity_registry`
  (`EntityRegistryService`); the grant policy itself →
  `entity_registry::OwnerGrantPolicy`; the actual access-grant rows →
  `crates/entity_access_db_utils`.

## Boundaries

- Depends on: `entity_registry`, `entity_access_db_utils`, `model_owner`,
  `shared_entity_registry`.
- Used by: `crates/ai_tools`, `crates/memory`, `crates/projects`,
  `crates/agent_session`, `crates/chat`, `crates/documents`,
  `crates/macro_db_client`, and services that create owned entities
  (`document_storage_service`, `agent_harness_service`, `scheduled_action`).

## Recipes

- Register a new owned entity type end to end: construct `NewEntityRecord`
  (via `entity_registry::NewEntityRecord::try_new`) → call
  `OwnedEntityRegistrar::register_owned_entity` inside your own transaction
  → commit once.

## Checks

- `cargo test -p entity_registry_db_utils` (`SQLX_OFFLINE` unset; requires
  local MacroDB — `just setup_macrodb`).

## Gotchas

- `insert_entity` is idempotent (`ON CONFLICT (id) DO NOTHING`); helpers
  never commit the caller's transaction.
- `register_owned_entity` is not an ownership-transfer API — conflicting
  owners/types fail rather than re-granting to a different principal.

## Related

- Rules: `.agents/rules/rust/db.md` · Crate:
  `crates/entity_registry/entity_registry`
