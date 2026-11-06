# initiative

## What it is

Belongs to tasks/project management: initiatives are a named grouping of
tasks. This crate owns initiative lifecycle, assignment policy, sharing,
properties, and activity.

## Start here

- `src/domain/service.rs` + `src/domain/service/reads.rs`: lifecycle and read
  logic.
- `src/domain/models.rs`: `Initiative`, `InitiativeError`.
- `src/domain/assignees.rs`, `src/domain/history.rs`, `src/domain/activity.rs`:
  assignment policy, change history, and activity recording.
- `src/outbound/pg_initiative_repo.rs` (+ `create.rs`, `list.rs`, `members.rs`,
  `share.rs`): the Postgres adapter, split by operation.
- `src/inbound/toolset/`: AI toolset surface (lifecycle, reads, sharing).
- `src/inbound/axum_router/`: REST surface (create/get/list/update/delete).
- `fixtures/initiative_test_data.sql`: seed data for repo tests.

## Scope

- Owns: initiative CRUD, assignment, sharing, properties, and activity.
- Not here: the GraphQL surface → `crates/graphql_initiative`; initiative
  descriptions (collab surface) → `crates/initiative_description`.

## Boundaries

- Depends on: `entity_access` (ports), `activity`, `models_permissions`,
  `macro_event_broker`/`macro_event_topics`, optionally `properties` /
  `system_properties` (feature `resources`).
- Used by: `graphql_initiative`, `ai_tools`, `initiative_description`,
  `agent_trigger`, `messages`, `soup_realtime`.

## Recipes

- Add a field or lifecycle rule: `src/domain/models.rs` →
  `src/domain/service.rs` → `src/outbound/pg_initiative_repo.rs` → the
  relevant `src/inbound/` surface (`toolset/` or `axum_router/`).
- Add a toolset action: `src/inbound/toolset/<area>.rs` →
  `src/domain/service.rs`.

## Checks

- `cargo test -p initiative --all-features` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`
- Skill: `cloud-storage-hexagonal-architecture`

`create_imported` is the trusted workspace-import creation path: it accepts a
ledger-derived id and complete source markdown. It checks attribution and owner
before reusing an existing project, and repairs property initialization on replay.
Interactive creation keeps its existing generated ids and description limits.
