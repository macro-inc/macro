# xtask_email_coverage

## What it is

`cargo x email-coverage`: the email end-to-end coverage measurement.

- `list` writes every backend email entry point (routes, webhook cases,
  GraphQL resolvers, queue messages, Kafka events, gateway pushes, agent
  tools, lambdas, provider API methods, background loops, and the
  hand-listed routes of other services that scenarios record) to
  `crates/email_e2e/coverage/entrypoints.tsv`, read from the source code so
  the list cannot go stale.
- `report` joins the records the `crates/email_e2e` scenarios leave
  (`evidence.json`) and nextest's `junit.xml` with the ledger, and says
  which functions of email are covered on Gmail and on Outlook and which
  entry points are reached. `crates/email_e2e/AGENTS.md` (Coverage) explains
  the ledger files.

## Start here

- `crates/email_e2e/coverage/sources.toml`: where each kind is looked for, and
  the few facts that are not in code (`src/sources.rs` is its schema).
- `src/list.rs`: one module per kind under `src/list/`; provider defaults and
  `[[applies]]` overrides.
- `src/list/http.rs`: the router walker. `src/repo.rs`: resolving a path such
  as `email::inbound::axum::send_router::send_router` to its file.
- `src/list/wire.rs`: the `match` column, from serde attributes.
- `src/report.rs`: the join and its rules (what counts as covered).
  `src/report/seen.rs`: which entry point a recorded request is.
  `src/report/ledger.rs`: `functions.toml`, `checks.tsv`, `waivers.toml` and
  the atoms (`<kind> <key> where <conditions>`). `src/report/render.rs`: the
  job summary and the page.

## Recipes

- Add a kind: variant in `src/row.rs` `Kind` → section in `src/sources.rs` and
  `sources.toml` → `src/list/<kind>.rs` → call it in `generate_from` → how a
  record shows it, in `Scenario::hits` (`src/report/seen.rs`).
- Add a subcommand: variant in `Command` in `src/main.rs`.
- Add a condition an atom can ask: `Condition` in `src/report/ledger.rs`.

## Checks

- `cargo test -p xtask_email_coverage`
- `cargo x email-coverage list --check` (passes when the checked-in list is current)
- After changing an email route, resolver, message type or tool:
  `cargo x email-coverage list`, commit the file, and give the new entry
  point a function in `crates/email_e2e/coverage/functions.toml`.
- `just email-e2e-coverage` after a local `just email-e2e`.

## Gotchas

- Never skip what cannot be resolved: return an error naming `file:line`. A
  silently missing row makes coverage look better than it is.
- The walker evaluates router functions made of `let` bindings and one final
  expression. Routes added in an `if` or by reassignment are an error by
  design; restructure the router or teach the walker.
- `source` lines need proc-macro2's `span-locations` feature.
- `list --check` compares everything but the line numbers in `source`: a
  line moves whenever its file changes above it. `list` refreshes them.
- The report fails without a `junit.xml`: nothing else says which records
  are of scenarios that passed.
- A GraphQL field is looked up in `static_assets/schema.graphql`; export the
  SDL first when a resolver is new.
- The report exits non-zero when the ledger contradicts the code or itself
  (an entry point in no function, a function with no entry, a name that does
  not exist), with or without `--enforce`. Coverage gaps fail only with
  `--enforce`.
- A record counts only when its scenario passed. A scenario that linked no
  inbox counts for both providers, and so does one that linked both.
