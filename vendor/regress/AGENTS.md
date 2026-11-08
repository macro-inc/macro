# regress (vendored)

## What it is

The crates.io 0.12.0 regex engine with the legacy ECMAScript case-folding fix.
Read `README-MACRO.md` before refreshing it from upstream.

## Scope

- Owns: upstream engine and the generated V8 legacy canonicalization table.
- Consumer conformance tests belong in
  `crates/client/lexical/lexical_workspace_tests`, outside this vendor copy.
- Preserve upstream layout and licenses; do not apply workspace source-layout
  or dependency-inheritance conventions to third-party code.

## Checks

- `cargo test --manifest-path vendor/regress/Cargo.toml --features utf16 -j4`
- `cargo test --release -p lexical_workspace_tests`

## Gotchas

- UTF-16 consumers use `Regex::is_unicode` to choose the matching input decoder.
- Legacy and Unicode case folding are different. Keep `u`/`v` behavior unchanged.
- Generate `src/legacy_case.rs` with the consumer's recorder under Node 24 / ICU 77.
- The crate is excluded from the root workspace. Do not commit its generated
  `Cargo.lock` or build output; the workspace lockfile owns the shipping graph.
