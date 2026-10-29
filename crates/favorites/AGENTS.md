# favorites

## What it is

Backs favoriting/pinning across Macro surfaces (sidebar, Home/Soup):
user- and team-scoped ordered collections of entities, following the
hexagonal architecture pattern.

## Start here

- `src/domain/service.rs` + `src/domain/mutation_service.rs`: the service and
  its mutation (reorder/add/remove) logic.
- `src/domain/ports.rs`: the repository port, implemented in `outbound`.
- `src/inbound/axum_router.rs`, `src/inbound/toolset.rs`: HTTP router and AI
  toolset adapter.
- `src/outbound/pg_favorites_repo.rs`: the Postgres adapter.

## Scope

- Owns: favoriting/ordering for any entity type, behind `ports`, `inbound`,
  `outbound`, `ai_tools` feature flags.
- Not here: the GraphQL favorites surface → `crates/graphql_favorite`.

## Boundaries

- Depends on: `entity_access` (ports), `macro_authorization` (inbound),
  `model-entity`, `cowlike`.
- Used by: `graphql_favorite`, `ai_tools`, `complete_graph`, `soup`,
  `document_storage_service`, `authentication_service`.

## Recipes

- Add a favoritable entity type: `validate_favoritable` in
  `src/domain/mutation_service.rs` → `list_favorites` in
  `src/outbound/pg_favorites_repo.rs` if the kind can be deleted → caller's
  feature wiring.
- Add an AI tool action: `src/inbound/toolset.rs` → `src/domain/mutation_service.rs`.

## Tool contracts

- The AI adapter omits legacy chat targets; only advertise entity types supported by the domain mutation service.
- `ExternalChat` entities are favoritable through the generic entity reference.

## Checks

- `cargo test -p favorites --all-features` (`SQLX_OFFLINE` unset).

## Gotchas

- Authorize adds with `ports::FavoriteView`, not `ViewAccessLevel`: channels
  resolve to channel roles, which `ViewAccessLevel` never accepts.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`

A channel-message favorite may expose a private message parent only to that message audience’s initiating user.
