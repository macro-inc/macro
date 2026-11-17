# xtask_loro_vendor

## What it is

The drift check for the editor's vendored loro-internal: with `native-editor`
off, the copy must compile from exactly the crates.io 1.17.1 source and manifest.

## Start here

- `src/strip.rs`: drops nodes whose `cfg` is false with the feature off and
  removes `cfg`s that are true; other predicates stay unknown.
- `src/main.rs`: per-file token comparison, the manifest's allowed local keys.
- `tooling/scripts/check-loro-editor-vendor.sh`: downloads and verifies the
  release, diffs the non-Rust files, runs this binary.

## Scope

- Owns: proving feature-off source equals upstream.
- Not here: which packages may enable the feature →
  `tooling/scripts/check-loro-native-editor-features.sh`.

## Checks

- `cargo test -p xtask_loro_vendor`
- `just check-loro-editor-vendor`

## Gotchas

- Compare token strings exactly; whitespace splitting only locates a
  difference, since a literal's inner whitespace is part of its bytes.
- Only whole items, statements, fields, variants and arms are stripped; any
  surviving reference to the feature fails rather than passing unseen.
- Comments and formatting are not compared.
