# Lexical model

## What it is

Portable editor model for the Lexical port. This crate owns values, registered
node types, immutable snapshots and transactional tree editing.

## Start here

- `src/lib.rs` exposes the model API.
- `src/node.rs` defines node kinds, inheritance and dispatch.
- `src/transaction.rs` owns writes; never mutate a committed snapshot.

## Boundaries

- Pure Rust model; no network, database, runtime or browser dependencies.
- Client crate: keep it excluded from workspace-hack through `crates/client/*`.
- Selection editing, normalization and the commit pipeline build on this layer.

## Checks

- `cargo test -p lexical_model -j4`
- `cargo check -p lexical_model --target wasm32-unknown-unknown -j4`
- `cargo clippy -p lexical_model --all-targets -j4 -- -D warnings`
- `cargo tree -p lexical_model --target wasm32-unknown-unknown -i workspace-hack`
- `cargo x deps --check`, `cargo shear`, `just check`

## Gotchas

- Text positions are UTF-16 code units; reject surrogate-splitting offsets.
- Node ancestry follows the kind trait's `Parent`, never Rust layout casts.
- Keep key allocation outside rollback, and snapshots independent on first write.
