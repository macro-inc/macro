# database_sql

## What it is

Part of the Databases feature: the SQL subset agents and the console use to
read and write Macro databases. A pure parse → resolve → split → engine →
fold pipeline, compiled natively and to `wasm32` (the browser's SQL editor
uses the wasm build directly).

## Start here

- `openapi` feature: optional derives for the HTTP result contract; keep native transport dependencies out of the engine.
- `src/lib.rs`: the pipeline diagram and the public re-exports — read this
  before any other file.
- `src/parse.rs` / `src/resolve.rs` / `src/split.rs` / `src/engine.rs` /
  `src/fold.rs`: the pipeline stages, in order; each has a sibling `test.rs`.
- `examples/repl.rs`: an interactive console against a live stack; `examples/gql.rs`
  shows the GraphQL queries `split` emits.
- `fixtures/transcripts/*.json`: one request/response fixture per SQL feature,
  used by the engine tests.

## Scope

- Owns: the SQL grammar, catalog binding, GraphQL-query splitting, and the row
  fold — i.e. the engine itself, with no knowledge of Postgres, Soup, or HTTP.
- Not here: the domain service that stores tables/rows and exposes the ops API
  → `crates/databases`; the agent-facing adapter that runs this engine over
  that service and Soup → `crates/databases_sql`.

## Boundaries

- Depends on: `filter_ast`, `item_filters` (predicate ASTs shared with other
  filtering code), `models_databases` (wire types).
- Used by: `crates/databases` and `crates/databases_sql` natively; the web
  app's database SQL console via the `wasm` module (crate-type `cdylib`).

## Recipes

- Add a SQL feature (new clause/function): `src/parse/ast.rs` + grammar in
  `src/parse/parser.rs` → `src/resolve.rs` (bind against the catalog) →
  `src/split.rs` (emit the GraphQL query) → `src/fold.rs` (shape rows) → add a
  fixture under `fixtures/transcripts/`.
- Regenerate the TypeScript wire types: `cargo run -p database_sql --features
  cli --bin database_sql_types` (never hand-edit the generated output).

## Checks

- `cargo test -p database_sql`.
- `cargo check -p database_sql --target wasm32-unknown-unknown` after touching
  anything outside `src/wasm.rs`, since the crate must keep compiling there.

## Gotchas

- Keep the crate free of native-only dependencies (no `tokio`, no `sqlx`) —
  it must compile to `wasm32`; native-only tooling goes behind the `cli` feature.
- The grammar is the contract: a statement this crate rejects must never reach
  `databases`' ops API some other way.

## Related

- Skill: `database-core` · Rules: `.agents/rules/rust/architecture.md`
