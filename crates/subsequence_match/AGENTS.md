# subsequence_match

## What it is

Pure Unicode normalization and ordered-subsequence matching shared by server
contact search and the client cache. Keep matching behavior consistent across them.

## Scope

- Owns: normalization, token eligibility, corpus-independent match quality, recipient tiers, and blend arithmetic (`src/ranking.rs`). Shared TSV fixtures verify Rust/browser parity.
- Not here: authorization, pagination, database reads, or each surface's chosen weights/boosts.
- Used by: `contacts`, `cache-core` (native and WASM).

## Checks

- `cargo test -p subsequence_match`
- Cache ranking parity remains covered by `cargo test -p cache-core`.

## Gotchas

- Keep this dependency-free and WASM-safe; do not pull backend infrastructure or
  workspace-hack into the client cache through this crate.
- Inputs to `subsequence_score` are normalized by the caller. SQL wildcards are
  ordinary characters here; SQL adapters escape their bound patterns separately.
