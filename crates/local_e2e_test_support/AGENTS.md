# local_e2e_test_support

## What it is

Belongs to local dev tooling: shared helpers for Rust local end-to-end
tests — fixture loading, local JWTs, and local-only service URLs.

## Start here

- `src/services.rs`: standard local service URLs for the `run_local` stack;
  refuses non-local URLs so tests can't mutate shared dev services.
- `src/jwt.rs`: generates local Macro API JWTs via `macro_auth`.
- `src/config.rs`: reads the xtask instance env file selected by
  `LOCAL_E2E_ENV_FILE` (falling back to `.env`), with process env overrides.
- `src/fixtures.rs`: loads fixture data from `tooling/seed_cli/seed`.
- `src/bin/generate_local_e2e_token.rs`: standalone token-generation binary.

## Scope

- Owns: test-only plumbing for the local E2E harness — never used in
  production services.
- Not here: the harness itself (`just local-e2e-rust`) or stack
  startup/seeding — see `crates/integration_tests/local_e2e`.

## Boundaries

- Depends on: `macro_auth`.
- Used by: `crates/integration_tests/local_e2e`, run only from ignored
  integration tests.

## Recipes

- Override a service URL for a test: `LOCAL_E2E_<SERVICE>_URL` env var (local
  endpoints only — non-local values are rejected in `src/services.rs`).

## Checks

- `just local-e2e-rust` (starts and seeds an isolated named stack first; do
  not run these tests directly without it).

## Gotchas

- These tests mutate an isolated named stack, not shared dev data — don't
  bypass the harness and run them against a shared environment.

## Related

- Docs: `docs/development/rust.md`
