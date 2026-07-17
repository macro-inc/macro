# local_e2e_test_support

Shared Rust helpers for local E2E tests.

- Loads fixture data from `tooling/seed_cli/seed`.
- Generates local Macro API JWTs from the xtask instance env selected by
  `LOCAL_E2E_ENV_FILE`, falling back to `.env`, with process env overrides.
- Provides standard local service URLs for the `run_local` stack.
- Refuses non-local service URLs so tests do not mutate shared dev services.

Use this crate from ignored integration tests that are run by `just local-e2e-rust`.
That harness starts and seeds an isolated named stack before running the tests.
Override service URLs only with local endpoints via `LOCAL_E2E_DOCUMENT_STORAGE_URL`
or `LOCAL_E2E_CONNECTION_GATEWAY_WS_URL`.
