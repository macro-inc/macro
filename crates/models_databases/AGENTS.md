# models_databases

## What it is

Part of Macro Databases. The typed write vocabulary: ops, cell/column/view
types, the cast rule, and fractional-index position keys — shared by the SQL
engine (which also runs in the browser via wasm), the HTTP API, and the
domain.

## Start here

- `src/ops.rs`: `DatabaseOp` and the row/column/view change/result types —
  the core vocabulary everything else is built from.
- `src/cast.rs`: the cell-value casting rule between column kinds.
- `src/views.rs` + `src/views/`: view filter/sort evaluation (`eval.rs`),
  Kanban lane keys (`lane_key.rs`, `lanes.rs`).
- `src/formula.rs`: derived/formula column types.
- `src/position.rs`: fractional-index row/column ordering.
- `src/ids.rs`: all database id newtypes (`DatabaseId`, `TableId`, `RowId`, …).

## Scope

- Owns: the write-op vocabulary, cell casting, view evaluation, and position
  keys — kept wasm-safe (no `workspace-hack` dependency; see `.config/hakari.toml`).
- Not here: SQL execution or the domain port → `database_sql`, `databases_sql`;
  Forms (a view of one table) → `models_forms`.

## Boundaries

- Depends on: `fractional_index`, `macro_user_id`, `macro_uuid` — no
  `workspace-hack`, so new dependencies must stay wasm-compatible.
- Used by: `crm`, `databases`, `database_sql`, `databases_sql`,
  `document_storage_service`, `forms`, `graphql_crm`, `models_forms`.

## Recipes

- Add a column kind: `src/ops.rs` (`ColumnKind`, `CellValue`) → `src/cast.rs`
  (casting rules) → `src/views/eval.rs` if it affects filtering/sorting →
  consumers in `database_sql`/`databases_sql`.
- Add a formula operator: `src/formula.rs` → `database_sql`'s formula evaluator.

## Checks

- `cargo test -p models_databases` (`SQLX_OFFLINE` unset).

## Gotchas

- Stay wasm-safe: don't add a dependency that isn't already wasm-compatible,
  and don't add `workspace-hack`.

## Related

- Skill: `database-core`
