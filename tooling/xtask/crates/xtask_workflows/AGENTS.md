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

- Edit Rust sources; regenerate YAML with `cargo x workflows`.
- Keep reusable-workflow permissions within the caller's permissions.
- Scope future-path exceptions to a closed list, filter group and committed spec.
- Clear prior result artifacts before accepting per-pipeline coverage evidence.
- Keep deployment and production access out of conformance workflows.
- Run the resolved native editor feature-graph guard before lexical/session compilation; production closures exclude compatibility/foreign-node features while explicit compatibility web remains a positive control.

- Run the pinned Lexical assertion-boundary guard in the web Typecheck job for web and shared-package changes.

## Checks

- `cargo test -p xtask_workflows -j4`
- `cargo clippy -p xtask_workflows --all-targets -j4 -- -D warnings`
- `cargo x workflows --check`
- `just check`, `just pr-privacy`

## Gotchas

- Step conditions use `if_condition` after `run` or `uses`; job conditions use `cond`.
- Lexical nightly and PR checks share builders. Session artifacts are pending
  until their crate lands; missing bundles fail the actual web-build bundle gate.
