# Local E2E integration tests

These tests run against the deterministic local E2E stack and seed data.

```bash
just local-e2e-rust
```

The tests are `#[ignore]` so normal workspace test runs do not require Docker
services. They load fixtures through `local_e2e_test_support`, which reads the
same seed files used by `seed_cli` and Playwright.
