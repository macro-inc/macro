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

- Add a favoritable entity type: `src/domain/models.rs` → `src/domain/service.rs`
  → `src/outbound/pg_favorites_repo.rs` → caller's feature wiring.
- Add an AI tool action: `src/inbound/toolset.rs` → `src/domain/mutation_service.rs`.

## Checks

- `cargo test -p favorites --all-features` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`
