# xtask_email_coverage

## What it is

`cargo x email-coverage`: the email end-to-end coverage measurement. `list`
writes every backend email entry point (routes, webhook cases, GraphQL
resolvers, queue messages, Kafka events, gateway pushes, agent tools, lambdas,
provider API methods, background loops) to
`crates/email_e2e/coverage/entrypoints.tsv`, read from the source code so the
list cannot go stale. The `crates/email_e2e` harness records which of them ran.

## Start here

- `crates/email_e2e/coverage/sources.toml`: where each kind is looked for, and
  the few facts that are not in code (`src/sources.rs` is its schema).
- `src/list.rs`: one module per kind under `src/list/`; provider defaults and
  `[[applies]]` overrides.
- `src/list/http.rs`: the router walker. `src/repo.rs`: resolving a path such
  as `email::inbound::axum::send_router::send_router` to its file.
- `src/list/wire.rs`: the `match` column, from serde attributes.

## Recipes

- Add a kind: variant in `src/row.rs` `Kind` → section in `src/sources.rs` and
  `sources.toml` → `src/list/<kind>.rs` → call it in `generate_from`.
- Add a subcommand: variant in `Command` in `src/main.rs`.

## Checks

- `cargo test -p xtask_email_coverage`
- `cargo x email-coverage list --check` (passes when the checked-in list is current)
- After changing an email route, resolver, message type or tool:
  `cargo x email-coverage list`, and commit the file.

## Gotchas

- Never skip what cannot be resolved: return an error naming `file:line`. A
  silently missing row makes coverage look better than it is.
- The walker evaluates router functions made of `let` bindings and one final
  expression. Routes added in an `if` or by reassignment are an error by
  design; restructure the router or teach the walker.
- `source` lines need proc-macro2's `span-locations` feature.
- A GraphQL field is looked up in `static_assets/schema.graphql`; export the
  SDL first when a resolver is new.
