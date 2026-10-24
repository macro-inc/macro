---
description: "Backend guardrails: how to run Rust tests, migrations, the SQLx cache, and crate boundaries."
paths:
  - "crates/**"
  - "services/**"
  - "tooling/**"
globs: "crates/**,services/**,tooling/**"
alwaysApply: false
---

# Backend guardrails

- Run Rust tests from the repository root with `cargo test -p <package>` and
  **leave `SQLX_OFFLINE` unset**. Offline mode is for checks, builds, and lints,
  not tests.
- Generate migrations with `sqlx migrate add`; never invent timestamped
  filenames. Never hand-edit `.sqlx/query-*.json`. Prepare the workspace cache
  from the root inside Nix with `just prepare_db` ([database
  guide](../../../docs/development/database.md)).
- Never generate `.sqlx` metadata for test queries: no `--tests` on prepare.
  Tests compile against the live database, so they don't need the cache.
- Across domain crates, depend on the owning domain service or port; only a
  composition root may construct that crate's outbound adapters. Never import
  another crate's `outbound` module from an outbound adapter. The narrow exception
  is `properties::query_support`: source repositories may use its DATE-query
  composition helpers over an already-authorized candidate CTE, while retaining
  source authorization, filtering, execution, and hydration.
- Read the [Rust development guide](../../../docs/development/rust.md) before
  building or testing, and the hexagonal architecture skill before changing
  inbound, domain, or outbound code.
