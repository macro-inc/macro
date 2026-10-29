# macro_db_migrator

## What it is

Exposes MacroDB's embedded SQLx migrator without pulling in the database client.
Migration files belong in `../macro_db_client/migrations/`.

## Start here

- `src/lib.rs`: the shared `MACRO_DB_MIGRATIONS` static.
- `src/test.rs`: historical-schema upgrade and migration failure regression tests.
- `src/test/*.sql`: fixtures targeting the schema before and after an upgrade.

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
- Exercise concurrent indexes through SQLx's migrator, outside explicit transactions.

## Related

- [Database guide](../../docs/development/database.md)
- [Database rules](../../.agents/rules/rust/db.md)
