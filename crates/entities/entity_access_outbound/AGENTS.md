# entity_access_outbound

## What it is

Shared infrastructure: the Postgres adapter behind `entity_access`'s
`AccessRepository` port, plus the `explain_access` CLI. Split out of
`entity_access` because most of that crate's commits touch these queries
while ~120 crates depend on its domain.

## Start here

- `src/pg_access_repo.rs`: `PgAccessRepository`. Form Edit/Owner grants Edit
  on the backing database; form View grants database View only when that form
  shares its responses.
- `src/pg_access_repo/queries/`: one module per entity kind.
- `src/bin/explain_access.rs`: CLI to explain why a user has (or lacks)
  access to an entity (feature `explain_binary`).

## Boundaries

- Depends on: `entity_access` (domain, with its `sqlx` feature).
- Used by: composition roots, `agent_tools`, `search_service`, `email` and
  `agent_harness` (which query source ids directly), `properties_service`,
  and many crates' tests as a dev-dependency.

## Recipes

- Debug a specific grant: `cargo run -p entity_access_outbound --bin
  explain_access --features explain_binary`.

## Checks

- `cargo test -p entity_access_outbound --all-features` (`SQLX_OFFLINE`
  unset; requires local MacroDB — `just setup_macrodb`). The fixtures live in
  `crates/entities/entity_access/fixtures`, which other crates' tests share.
