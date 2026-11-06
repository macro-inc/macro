# collab_surface

## What it is

Part of Documents (and other features that embed collaborative markdown):
stable ids for arbitrary collaborative markdown surfaces, each backed by
its own Loro CRDT session in sync-service, independent of the `Document`
table.

## Start here

- `src/lib.rs`: module doc — the hexagonal layout and why a surface has no
  owner (authorization derives from the parent entity).
- `src/domain/ports.rs`: `CollabSurfaceRepo` (outbound) and the service traits
  consumers depend on.
- `src/domain/models.rs`: `SurfaceOwnership`/parent policy — read before adding
  a new parent type.
- `src/domain/service.rs`: `CollabSurfaceService` / `OwnedSurfaceService` logic
  (ensure, retire, connection tokens).

## Scope

- Owns: the `collab_surfaces` table (id, parent, lifecycle state, soft
  deletion), surface ensure/retire, and minting sync-service connection tokens.
- Not here: markdown content itself (sync-service/Loro is the source of
  truth), and parent-entity authorization (the owning feature decides access,
  this crate only derives tokens from it).

## Boundaries

- Depends on (by feature): `entity_access` (ports), `macro_authorization`
  (inbound), `lexical_client` + `sync_service_client` (outbound init),
  `macro_db_client` (postgres).
- Used by: `forms`, `ai_tools`, `initiative_description`,
  `document_storage_service` — each wires its own domain port over
  `OwnedSurfaceService` or calls `CollabSurfaceService` directly for
  public-API-managed surfaces.

## Recipes

- Add a new parent type: `src/domain/models.rs` (`SurfaceOwnership`/parent
  policy) → `src/domain/service.rs` → the consuming feature's domain port (see
  `crates/initiative_description/src/lib.rs` for the pattern).
- Wire a new feature onto an existing surface kind: the feature's domain port
  → `OwnedSurfaceService` methods (`ensure_owned_surface`,
  `owned_surface_markdown`, `retire_surface`) → its cleanup path for
  retirement.

## Checks

- `cargo test -p collab_surface` (`SQLX_OFFLINE` unset; exercises
  `src/outbound/pg_collab_surface_repo/test.rs` against MacroDB).

## Gotchas

- Surface ids are application-generated UUIDv7 and name the sync-service
  session; never recycle one, even after retirement.
- Retirement blocks new connection tokens but does not reclaim the
  sync-service session — it's a one-way lifecycle step.
- The parent reference is polymorphic with no FK cascade; wiring retirement
  into the parent feature's own cleanup is the caller's responsibility.

## Related

- Skill: `.agents/skills/collab-surface-core/SKILL.md` · Rules:
  `.agents/rules/rust/architecture.md`, `.agents/rules/rust/security.md`
