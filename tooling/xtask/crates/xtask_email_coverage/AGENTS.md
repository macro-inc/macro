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
  which functions of email are proved, claimed or only performed on Gmail
  and on Outlook and which entry points are reached. `crates/email_e2e/AGENTS.md` (Coverage) explains
  the ledger files.

## Start here

- `crates/email_e2e/coverage/sources.toml`: where each kind is looked for, and
  the few facts that are not in code (`src/sources.rs` is its schema).
- `src/list.rs`: one module per kind under `src/list/`; provider defaults and
  `[[applies]]` overrides.
- `src/list/http.rs`: the router walker. `src/repo.rs`: resolving a path such
  as `email::inbound::axum::send_router::send_router` to its file.
- `src/list/wire.rs`: the `match` column, from serde attributes.
- `src/report.rs`: the join and its rules (what counts as proved, claimed,
  performed, waived, deferred, owned elsewhere or open).
  `src/report/seen.rs`: which entry point a recorded request is.
  `src/report/ledger.rs`: `functions.toml`, `checks.tsv`, `proofs.tsv`,
  `waivers.toml` and the atoms (`<kind> <key> where <conditions>`). `src/report/render.rs`: the
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
- `just email-e2e-coverage` after a local `just email-e2e`; add `--enforce`
  to see what CI fails on.

## Gotchas

- Never skip what cannot be resolved: return an error naming `file:line`. A
  silently missing row makes coverage look better than it is.
- The walker evaluates router functions made of `let` bindings and one final
  expression. Routes added in an `if`, by reassignment anywhere in a
  statement, or through a `&mut` borrow of the router are an error by
  design; restructure the router or teach the walker.
- A hand-listed route (`[[elsewhere]]`) must be registered in its file under
  its method: `.route("<end of the path>", <method>(..))`. A path in a
  comment or an attribute does not count. Under a `.nest(` the path alone
  counts, since the nested router is in another crate.
- A resolver's SDL type comes from the code (its own name, a rename, the
  types it is merged into) or a `[[graphql_type]]` mapping, never from a
  field of the same name on some other type.
- The queue check reads variables by name across the worker file: a name
  bound to a queue and to anything else is an error.
- `source` lines need proc-macro2's `span-locations` feature.
- `list --check` compares everything but the line numbers in `source`: a
  line moves whenever its file changes above it. `list` refreshes them.
- The report fails without a `junit.xml`: nothing else says which records
  are of scenarios that passed. It also fails on one that is cut short or
  holds a different number of tests than it says. Of two results for one scenario the worse
  counts.
- A scenario that passed only on a retry counts as passed and is listed
  under "Flaky".
- A GraphQL field counts as reached when an answered query selected it. One
  under `@skip` or `@include` counts only when the condition is written out
  and lets it run; a record keeps no variable values. A record keeps no
  answers either, so a field selected under a parent that came back null
  still counts as reached.
- A GraphQL field is looked up in `static_assets/schema.graphql`; export the
  SDL first when a resolver is new.
- The report exits non-zero when the ledger contradicts the code or itself
  (an entry point in no function, a function with no entry, a name that does
  not exist), with or without `--enforce`. Coverage gaps fail only with
  `--enforce`.
- Only **proved** is covered: a scenario performs the function, `checks.tsv`
  says it checks the result, and `proofs.tsv` names a break in product code
  that made it fail on that provider. Without the proof it is **claimed**.
  With `--enforce` everything not proved and not waived or deferred is a
  gap. CI enforces.
- The gaps are one list (`src/report/gaps.rs`, printed as `gap:` lines and
  in the report): failed scenarios, functions not proved, entry points not
  reached, stale ledger lines, and known-bug scenarios that pass. A
  function a known bug holds open is not a gap, and neither is an entry
  point all of whose functions are held open on that provider.
- `--known-bugs <dir>`, once per job that runs the scenarios kept for known
  bugs, reads that job's `junit.xml`: a scenario there that passed at the
  first attempt is a gap unless `waivers.toml` names it under
  `[[intermittent_bug]]` (one that failed and passed on the retry still
  shows its bug); an `[[intermittent_bug]]` naming a scenario those runs do
  not hold is a gap too. A directory with no `junit.xml` fails the report,
  so a job that has no such scenario left must stop being passed (the list
  is in `email_e2e_coverage.sh`). Without the flag nothing is judged.
- A `bug` in `functions.toml` must be the id of an
  `#[ignore = "known bug: <id>"]` in `crates/email_e2e/tests`, and every
  `#[ignore]` there must have such a reason: the report fails otherwise,
  with or without `--enforce`. A `bug` line left behind would keep its
  function out of the gaps for good.
- A proof naming an unknown function, a provider other than `gmail` or
  `outlook`, or a scenario not in the results is broken (always fails); one
  whose scenario no longer performs and checks the function is stale.
- Deferred is not waived: a function with `outside` in `functions.toml` and
  an entry point under `[[deferred]]` in `waivers.toml` wait for the
  full-stack tier and have their own count. `[[dead_code]]` waives an entry
  point with no caller and lists it under "Dead code candidates".
- Owned is not waived either: an entry point under `[[owned]]` in
  `waivers.toml` (the calendar provider methods) is in none of email's
  totals, reached or not, and is listed under "Counted with the calendar
  functions" and in `coverage.json` (`owned`, with whether a scenario
  reached it). One that is also waived, deferred, dead code, mapped in
  `functions.toml` or missing from the list is a ledger error.
- `bug = "<id>"` in a function's mapping keeps it open (on one provider with
  `bug_on = "gmail"` or `"outlook"`): its scenarios,
  checks and proofs are not looked at.
- A record counts only when its scenario passed in the run that wrote it:
  the harness writes nextest's run id (`NEXTEST_RUN_ID`) into the record and
  the report matches it with the `uuid` of the `junit.xml` the scenario
  passed in. A log directory that keeps records of earlier runs therefore
  adds nothing, and a `junit.xml` without a run id is refused. A scenario that linked no
  inbox counts for both providers, and so does one that linked both.
