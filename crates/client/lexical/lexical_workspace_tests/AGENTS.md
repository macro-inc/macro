# lexical_workspace_tests

## What it is

Dependency conformance for the portable Lexical workspace. No runtime API.

## Start here

- `src/test.rs`: exhaustive UTF-16 regex equivalence and Loro snapshot smoke test.
- `record-icase.mjs`: records the V8 oracle and generates the legacy case table.

## Boundaries

- Tests consume workspace `regress` and `loro`; no workspace-hack dependency.
- Production regex changes belong in `vendor/regress`.

## Checks

- `cargo test --release -p lexical_workspace_tests`
- `cargo check -p lexical_workspace_tests --target wasm32-unknown-unknown`
- `cargo clippy -p lexical_workspace_tests --all-targets -- -D warnings`
- `cargo tree -p lexical_workspace_tests --target wasm32-unknown-unknown -i workspace-hack`
- `cargo x deps --check`, `cargo shear`, `just check`
- Cross-language snapshot: run `cargo run --release -p lexical_workspace_tests
  --example loro_snapshot` and pipe its stdout to `node
  crates/client/lexical/lexical_workspace_tests/check-loro.mjs` after `npm ci
  --prefix services/sync-service --ignore-scripts`.

## Gotchas

- Record with Node 24 built with ICU 77 (official Node 24.0.0 qualifies), not a
  distro build with another ICU. Regenerate `tests/fixtures/icase-v8.json` and
  `vendor/regress/src/legacy_case.rs` together. Identity classes are implicit.
- The exhaustive test scans every BMP unit for each literal and character class;
  use release mode. Negative matches use maximal runs to encode the same set.
- Fixtures represent input as UTF-16 units so lone surrogates survive JSON.
- Use `find_from_ucs2` for legacy JS code-unit matching; `find_from_utf16`
  decodes surrogate pairs even without the Unicode flag.
