# Local E2E integration tests

These tests run against the deterministic local E2E stack and seed data.

```bash
just local-e2e-rust
```

The tests are `#[ignore]` so normal workspace test runs do not require Docker
services. The command starts an isolated named stack through the xtask local
orchestrator, seeds it, and supplies its generated env and proxy URLs to
`local_e2e_test_support`. The fixtures are the same files used by `seed_cli`
and Playwright.

## Scoped bot entity access

`bot_entity_access` connects directly to MacroDB to create an isolated
team-owned bot, token, channels, and document grants, then exercises DSS's
`/entity/{entity_type}/{entity_id}/permissions` endpoint under team and user
scope. It uses random UUIDs and removes its rows after verification.

Compile the test without requiring the local stack:

```bash
nix develop --command cargo test -p local_e2e_integration_tests --test bot_entity_access --no-run
```

To run it against an already-running local stack:

```bash
nix develop --command cargo test -p local_e2e_integration_tests --test bot_entity_access -- --ignored --nocapture
```

The test reads `LOCAL_E2E_DATABASE_URL` and
`LOCAL_E2E_DOCUMENT_STORAGE_URL`, falling back to the standard local MacroDB
and DSS addresses.
