# crates/testing

## What it is

Test support: the local end-to-end suite that drives an isolated local stack (`local_e2e`), and the helpers other crates' tests use against it. Only dev-dependencies may point here.

Layer: `testing` in [`.config/layers.toml`](../../.config/layers.toml), which
lists what this group may depend on. `cargo x deps` reports edges that break it.

## Crates

| Crate | What it is |
| --- | --- |
| [`local_e2e`](local_e2e/AGENTS.md) | Belongs to local dev tooling: end-to-end Rust tests (`local_e2e` package) that run against an isolated local stack started through the xtask local orchestrator, seeded … |
| [`local_e2e_test_support`](local_e2e_test_support/AGENTS.md) | Belongs to local dev tooling: shared helpers for Rust local end-to-end tests — fixture loading, local JWTs, and local-only service URLs. |

## Recipes

- Add a crate here: create `crates/testing/<name>` with its own `AGENTS.md`
  (from `.agents/templates/AGENTS.md`), add it to the root `members` and run
  `cargo x deps`, which adds its `[workspace.dependencies]` entry once
  something depends on it. Add it to the table above.
