# soup

## What it is

Backs the Home, Recent, Signal/work-feed, and GraphQL Soup query surfaces.
Soup is the amalgamated query service: callers filter across many entity
types (documents, channels, chats, calendar events, agent sessions, database
rows, initiatives, ...) and get back a single unified, paginated result.

## Start here

- `src/domain/service.rs`: the main query service; `src/domain/ports.rs` for
  its repository/collaborator traits.
- `src/domain/models.rs` (+ `grouping.rs`, `exclusions.rs`, `contact_listing.rs`):
  the unified `SoupItem`/grouping/exclusion shapes.
- `src/domain/service/favorites.rs`, `agent_metadata.rs`: entity-kind-specific
  query logic layered onto the core service.
- `src/outbound/pg_soup_repo.rs`: the Postgres repo, split by entity kind
  (`database_row.rs`, `calendar_event.rs`, `agent_session.rs`, `initiative.rs`,
  `attention.rs`, `notified.rs`, `touched.rs`) and by shape
  (`expanded/` hydrated, `unexpanded/` id-only).
- `src/inbound/axum_router.rs` + `src/inbound/toolset/list_entities.rs`: the
  HTTP route and the AI-tool surface over the same service.

## Scope

- Owns: cross-entity filtering, sorting, grouping, exclusion, and pagination
  logic, and the Postgres queries that back it.
- Not here: how a specific entity type is created/edited (channels, documents,
  initiatives, ...); per-entity-type cache projection → `soup_filter_projection`;
  realtime fan-out of Soup patches → `soup_realtime`.

## Boundaries

- Depends on: `entity_access`, `properties`, `crm`, `item_filters`,
  `filter_ast`, `favorites`, `frecency`, `channels`, `email`, `call`,
  `github_pull_requests`, `foreign_entity`, `activity`, `agent_changes`.
- Used by: `ai_tools`, `attention_feed`, `complete_graph`, `databases_sql`,
  `graphql_initiative`, `graphql_soup`, `graphql_work_feed`, `memory`, `skills`,
  `soup_filter_projection`.

## Recipes

- Add a new queryable entity kind: `src/domain/models.rs` (variant) →
  `src/outbound/pg_soup_repo/<kind>.rs` (expanded + unexpanded if both apply) →
  `src/domain/service.rs` wiring → `src/domain/ports.rs` if a new
  collaborator is needed.
- Add a filter/sort option: `item_filters`/`filter_ast` (the filter language) →
  `src/domain/models.rs` → the matching `src/outbound/pg_soup_repo/*` query.
- Change which candidates attention feeds (Home's work feed) page:
  `src/domain/service/tests/attention.rs` → `src/outbound/pg_soup_repo/attention.rs`
  (`attention/query.sql`). Channel-thread keying applies only to
  `AttentionKeying::ThreadScoped`; keep it in step with `attention_feed`'s
  `keying.rs`.

## Tool contracts

- The AI `ListEntities` adapter includes agent sessions and excludes legacy chats; public feed contracts retain historical chat support.

## Checks

- `cargo test -p soup --features outbound` (`SQLX_OFFLINE` unset; needs local
  MacroDB). Without the feature the Postgres repo and its tests don't compile.
- After schema/query changes: `nix develop --command just prepare_db` (see `justfile`).

## Gotchas

- `expanded/` vs `unexpanded/` queries exist because hydrating full entities
  is expensive — don't widen `unexpanded` to return hydrated data; add a new
  `expanded` path instead.
- `candidate_gates.rs` encodes access-gate SQL shared across repo queries;
  changing it changes what every entity kind can return.
- Queries over a known id list (`*/by_ids.rs`, hydration) and the initiative
  listing (`initiative_access_clause`) check access per row with `EXISTS` on
  `entity_access`, matching sources with `= ANY(ARRAY(SELECT ...))` so they are
  collected once rather than semi-joined per row. Building the caller's whole
  accessible set first scans `entity_access` once per source, so cost grows
  with the table and the caller's channels, not the page. A listing `EXISTS`
  also needs `PER_CANDIDATE`, or Postgres hashes it back into the whole set.

## Related

- Skill: `database-core`, `cloud-storage-hexagonal-architecture` · Rules:
  `.agents/rules/rust/db.md`, `.agents/rules/rust/architecture.md`
