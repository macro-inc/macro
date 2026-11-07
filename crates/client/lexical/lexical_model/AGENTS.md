# Lexical model

## What it is

Portable values for the Lexical editor port. This crate owns generation-aware
keys, UTF-16 text buffers, formatting and CSS declaration parsing.

## Start here

- `src/lib.rs` exposes the model API.
- Keep editor text positions in UTF-16 code units; reject split surrogate pairs.

## Boundaries

- Pure Rust model; no network, database, runtime or browser dependencies.
- Client crate: keep it excluded from workspace-hack through `crates/client/*`.

## Checks

- `cargo test -p lexical_model -j4`
- `cargo check -p lexical_model --target wasm32-unknown-unknown -j4`
- `cargo clippy -p lexical_model --all-targets -j4 -- -D warnings`
- `cargo x deps --check`, `cargo shear`, `just check`
