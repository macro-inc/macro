# entity_mutation

## What it is

Shared infrastructure used across every entity-owning feature: the
canonical mutation vocabulary (`rename`, `move`, `trash`, `restore`,
`duplicate`, `permanently delete`, `update share policy`) that each entity
domain crate implements, so a composition-layer router can dispatch to any
entity kind generically.

## Start here

- `src/capability.rs`: the per-capability traits (`RenameEntity`,
  `MoveEntity`, `TrashEntity`, `RestoreEntity`, `DuplicateEntity`,
  `DeleteEntityPermanently`, `UpdateEntitySharePolicy`) — implemented by each
  entity domain crate, not by anything here.
- `src/models.rs`: shared request/effect/error types
  (`EntityMutationEffect`, `EntityMutationErrorCode`).
- `src/ports.rs`: `EntityMutationService`, the router-facing port.

## Scope

- Owns: the shared mutation vocabulary and effect types.
- Not here: any entity kind's actual rename/move/trash logic (lives in that
  entity's own domain crate, e.g. `crates/documents`, `crates/chat`); the
  router dispatching to them → the DSS entity mutation service.

## Boundaries

- Depends on: `entity_access` (for `EntityAccessReceipt`/`RequiredPermission`),
  `model-entity`, `models_permissions`.
- Used by: `crates/channels`, `crates/email`, `crates/forms`, `crates/databases`,
  `crates/projects`, `crates/call`, `crates/chat`, `crates/documents`,
  `crates/graphql_entity_mutation`, `crates/graphql_favorite`,
  `services/document_storage_service`.

## Recipes

- Add a capability: a trait in `src/capability.rs` (with an associated
  `Receipt: RequiredPermission`) → export it from `src/lib.rs` → implement it
  in each entity domain crate that supports it.

## Checks

- `cargo test -p entity_mutation`.

## Related

- Rules: `.agents/rules/rust/architecture.md`
