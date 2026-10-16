# databases_sql

## What it is

Part of the Databases feature: runs the `database_sql` engine over Macro
databases for agents, as the agent-tool counterpart to the browser's direct
`database_sql` wasm usage. Reads go through Soup and contacts, writes go
through `databases`' typed ops.

## Start here

- `src/lib.rs`: module list and public re-exports (`DatabasesSql`, `SqlRequest`,
  `SqlOutcome`).
- `src/service.rs`: the entry point — runs a parsed statement's engine
  `Request`s against `row_source`/`ops_sink` and returns a `SqlOutcome`.
- `src/row_source.rs` / `src/ops_sink.rs`: the two adapters that plug this
  crate's Soup/contacts/databases access into the `database_sql` engine's
  generic `RowSource`/write traits.
- `src/toolset.rs` + `src/toolset/*.md`: the `QueryDatabase` and
  `SaveDatabaseQuery` agent tools; the `.md` files are the tool descriptions
  sent to the model.
- `src/view_only.rs`: a read-only variant of access, used where writes must be
  refused.

## Scope

- Owns: binding the `database_sql` engine to live Macro data for agents, and
  the two SQL agent tools.
- Not here: the SQL grammar/engine itself → `crates/database_sql`; table/row
  persistence and the ops API → `crates/databases`.

## Boundaries

- Depends on: `database_sql` (engine), `databases` (ops/storage, `ports` only),
  `soup`, `contacts`, `entity_access` (all `ports`-only — this crate is an
  adapter, not a composition root).
- Used by: `crates/ai_tools` (wires the `ai_tools` feature's `QueryDatabase`/
  `SaveDatabaseQuery` into the agent toolset).

## Recipes

- Change what a SQL read/write can see or do: `src/row_source.rs` or
  `src/ops_sink.rs` → `src/service.rs`.
- Edit a tool's behavior or its description: `src/toolset/query_database.rs` /
  `query_database_writes.md` or `src/toolset/save_database_query.rs` →
  `src/toolset/sql_guide.md` if the shared SQL guidance text changes.

## Checks

- `cargo test -p databases_sql --features ai_tools`.

## Gotchas

- This crate only depends on `ports` features of its domain crates — it must
  not import `databases`' or `soup`'s `outbound` adapters directly; the
  composition root supplies those.

## Related

- Skill: `database-core` · Rules: `.agents/rules/rust/architecture.md`
