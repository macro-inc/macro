# Workflow generator

## What it is

Rust sources for generated GitHub Actions YAML. Keep orchestration here and
TypeScript job logic in the owning package.

## Start here

- `src/workflows.rs`: workflow registry and deterministic YAML rendering.
- `src/workflows/pr_ci.rs`: path-filtered reusable callers and the CI gate.
- `src/workflows/steps.rs`, `runners.rs`, `vars.rs`: shared builders.
- `src/workflows/path_validation.rs`: checkout-backed path validation.

## Boundaries

- Typecheck decorator browser fixtures in the functional job after its canonical WASM build, outside the artifact-independent main web typecheck.

- Edit Rust sources; regenerate YAML with `cargo x workflows`.
- Keep reusable-workflow permissions within the caller's permissions.
- Scope future-path exceptions to a closed list, filter group and committed spec.
- Clear prior result artifacts before accepting per-pipeline coverage evidence.
- Keep deployment and production access out of conformance workflows.
- Run the resolved native editor feature-graph guard before lexical/session compilation; production closures exclude compatibility/foreign-node features while explicit compatibility web remains a positive control.

- The web Typecheck job must not reference the removed standalone facade (`typecheck_excludes_the_deferred_lexical_facade`).
- Build agent-fold and the production document-session WASM before web unit-test shards; package tests must not depend on external artifact manifests.

## Checks

- `cargo test -p xtask_workflows -j4`
- `cargo clippy -p xtask_workflows --all-targets -j4 -- -D warnings`
- `cargo x workflows --check`
- `just check`, `just pr-privacy`

## Gotchas

- Step conditions use `if_condition` after `run` or `uses`; job conditions use `cond`.
- Keep conformance replay and session-contract checks local. The existing Rust
  check job enforces vendor token parity and deployed-server Loro feature
  isolation on their input paths, with a conditional 30-minute budget (20
  otherwise). Server-upstream tests and the editor differential suite remain
  local. Existing web WASM builds, decorator typechecks and bundle gates stay
  in their owning jobs.

