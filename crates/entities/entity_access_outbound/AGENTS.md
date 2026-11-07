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
- Used by: composition roots, `ai_tools`, `search_service`, `email` and
  `agent_harness` (which query source ids directly), `properties_service`,
  and many crates' tests as a dev-dependency.

## Recipes

- Debug a specific grant: `cargo run -p entity_access_outbound --bin
  explain_access --features explain_binary`.

## Gotchas

- `get_documents_access` checks many documents in one statement
  (`queries/document_access/documents_access.sql`) and must answer each one as
  `get_document_access` does: change their sources together, and extend
  `test/documents_access.rs` and its fixture, which compare the two.
- `EntityAudienceLookup::get_entity_audiences` resolves many entities' users at
  once: kinds whose users are exactly their `entity_access` grants go through
  one grouped lookup (`queries/entity_audiences.rs`: grants, then team and
  channel members once per distinct source). CRM audiences always read current
  membership; other kinds and single ids use the cached per-entity
  `get_users_by_entity`. Keep it in step with
  `get_entity_users`.
- `get_user_source_ids` is cached for 10 s per process and concurrent misses
  for one user share one query through `single_flight`. A failure then arrives
  as `Arc<sqlx::Error>`; `anyhow_access_error` classifies both forms, so route
  new callers' errors through it.

## Checks

- `cargo test -p entity_access_outbound --all-features` (`SQLX_OFFLINE`
  unset; requires local MacroDB — `just setup_macrodb`). The fixtures live in
  `crates/entities/entity_access/fixtures`, which other crates' tests share.
