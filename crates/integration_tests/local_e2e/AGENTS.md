# local_e2e (crates/integration_tests/local_e2e)

## What it is

Belongs to local dev tooling: end-to-end Rust tests
(`local_e2e_integration_tests` package) that run against an isolated local
stack started through the xtask local orchestrator, seeded with the same
fixtures `seed_cli` and Playwright use.

## Start here

- `README.md`: how to run tests against a fresh or already-running stack, and
  which env vars they read (`LOCAL_E2E_DATABASE_URL`,
  `LOCAL_E2E_DOCUMENT_STORAGE_URL`).
- `tests/`: one file per scenario (`bot_entity_access.rs`,
  `channel_mutations.rs`, `channel_websocket.rs`).
- `tests/support/`: shared HTTP and websocket helpers.
- `src/lib.rs`: thin — most logic lives under `tests/`.

## Scope

- Owns: full-stack Rust integration tests that need a running local stack
  (Postgres, DSS, gateway).
- Not here: unit/integration tests scoped to one crate — those live beside
  their crate.

## Recipes

- Add a scenario: `tests/<name>.rs` → reuse `tests/support/http.rs` /
  `websocket.rs` for requests.

## Checks

- `just local-e2e-rust` runs the full suite against a fresh isolated stack.
- `nix develop --command cargo test -p local_e2e_integration_tests --test <name> --no-run`
  compiles a single test without requiring the stack.
- `nix develop --command cargo test -p local_e2e_integration_tests --test <name> -- --ignored --nocapture`
  runs it against an already-running stack. Tests are `#[ignore]`d so normal
  workspace runs skip them.

## Related

- Docs: `docs/development/running-locally.md`
