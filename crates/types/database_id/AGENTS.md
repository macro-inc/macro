# database_id

## What it is

Shared types for Databases: the ids of a database and its parts
(`DatabaseId`, `TableId`, `ColumnId`, `RowId`, `OptionId`, `ViewId`,
`QueryId`, `PropertyId`), each a `uuid_id!` newtype (CS-10) that is the plain
UUID string on the wire and in every generated schema.

## Boundaries

- Depends on: `id_newtype`, `utoipa`, `specta`; `schemars` behind `schema`.
  Wasm-safe (the SQL engine runs in the browser); a hakari traversal exclude.
- Used by: `models_databases`, which re-exports every id, and through it the
  databases, forms and SQL engine crates.

## Checks

- `cargo test -p database_id --all-features`
- After a change: `cargo run -p database_sql --features cli --bin database_sql_types`
  must leave `apps/web/src/lib/core/database-sql/generated/types.ts` unchanged.

## Gotchas

- Each id inlines the UUID's own JSON Schema (`schema` feature) so agent tool
  schemas read as a plain uuid string; the forms ids derive theirs instead.
