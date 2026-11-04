# xtask_graphql_schema_compat

## What it is

`cargo x graphql-schema-compat`: the CI guard that stops a GraphQL schema change
from breaking deployed clients (App Store bundles, cached tabs, desktop OTA
bundles), which keep sending old documents for weeks.

## Start here

- `src/lib.rs`: what counts as breaking, and the `Remove after YYYY-MM-DD`
  marker that allows a removal once its date passes.
- `src/main.rs`: compares the working-tree `static_assets/schema.graphql` with
  the schema at `git merge-base <base> HEAD`.

## Checks

- `cargo test -p xtask_graphql_schema_compat`
- `cargo x graphql-schema-compat` (fetch `origin/main` first)

## Gotchas

- Variance is directional: output fields may only narrow (nullable to non-null),
  inputs may only widen. Don't flip `is_assignable_to` arguments.
- Types carry the marker in their description because GraphQL cannot deprecate
  a type; descriptions wrap, so the parser collapses whitespace.

## Related

- Docs: [`docs/guides/add-graphql-field.md`](../../../../docs/guides/add-graphql-field.md) step 8
- CI: `graphql-schema-compat` job in `tooling/xtask/crates/xtask_workflows/src/workflows/code_check_cloud_storage.rs`
