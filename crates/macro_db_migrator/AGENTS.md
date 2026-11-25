# macro_db_migrator

## What it is

Exposes MacroDB's embedded SQLx migrator without pulling in the database client.
Migration files belong in `../macro_db_client/migrations/`.

## Start here

- `src/lib.rs`: the shared `MACRO_DB_MIGRATIONS` static.
- `src/test.rs`: historical-schema upgrade and migration failure regression tests.
- `src/test/*.sql`: fixtures targeting the schema before and after an upgrade.
- `src/test/task_dependencies.rs` and `src/test/task_dependencies/projection.rs`: dense historical sources, delayed shared-hub projection, legacy inter-phase writes, and contention retries on PG14.

## Scope

- Owns: embedding migrations and testing migration sequencing and atomicity.
- Not here: application queries or schema files; use the owning crate or MacroDB client.

## Checks

- Run `cargo test -p macro_db_migrator` with `SQLX_OFFLINE` unset and a local database.
- Run `just check` for code changes.

## Gotchas

- Start historical-schema tests with an empty public schema; CI's test template
  may already contain all migrations.
- Use SQL fixtures for statements that target a historical schema; current-schema
  SQLx macros cannot validate columns that have since been removed or added.
- Document runtime CALLs to temporary migration procedures that the final compiler schema has already dropped; keep ordinary fixture DML macro-checked.
- Backfill locks signed endpoint keys before source rows, uses NOWAIT for row-first contention, and revalidates discovery; test contention with barriers and 40001 retry.
- Backfill commits source batches before projecting touched blockers once per page. The retry retains touched targets in the same session and reconstructs them in a new session; inverse projections read current edges, skip unchanged values, and never recreate deleted roots.
- Exercise concurrent indexes through SQLx's migrator, outside explicit transactions.
- Keep the migrations fingerprint `build.rs` passes as a cfg: sccache keys this
  crate on its arguments, and without it CI reused a migrator missing a renamed
  migration.

## Related

- [Database guide](../../docs/development/database.md)
- [Database rules](../../.agents/rules/rust/db.md)
