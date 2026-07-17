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
