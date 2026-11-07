# Lexical conformance WASM

## What it is

Development-only raw-model transaction facade for WP-07's upstream text/paragraph
Tier C differential harness. Never import it from production crates or bundles.

## Start here

- `src/lib.rs`: isolated `CoreHandle`, JSON transaction boundary and build identity.
- `src/command.rs`: text/paragraph commands and explicit host-resolved view inputs.
- `src/snapshot.rs`: state, selection, identities and pre-view-cache commit records.
- `packages/lexical-conformance/diff/`: loader, reproducible build and JS oracle.

## Boundaries

- Keep `publish = false`, `cdylib` plus `rlib`, and client workspace-hack exclusion.
- Enable the reserved `foreign-nodes` feature only here; WP-54 supplies JS hooks.
- WP-07 uses raw `Editor` transactions. WP-14 replaces v0 JSON commands with
  EditorCore and the session codec. Rich nodes, history, markdown and Tier B are
  later work packages; do not claim these exports implement their contracts.
- Keep S1's UTF-16 edit validation. Interior selection offsets are allowed; edits
  splitting a surrogate pair fail atomically. The differential generator uses
  valid edit boundaries and separately verifies the S1 rejection cases.
- Inputs are development data; never use production credentials or documents.

## Checks

- `TMPDIR=/home/wolf/tmp cargo test -p lexical_conformance_wasm -j4`
- `TMPDIR=/home/wolf/tmp cargo clippy -p lexical_conformance_wasm --all-targets -j4 -- -D warnings`
- `TMPDIR=/home/wolf/tmp cargo check -p lexical_conformance_wasm --target wasm32-unknown-unknown -j4`
- `cargo tree --workspace -i lexical_conformance_wasm -e normal`: only itself.
- `cargo x deps --check`, `just check`.
- `STEPS=10000 bunx vitest run --config packages/lexical-conformance/diff/vitest.config.mts`

## Gotchas

- Build artifacts live in this worktree's `target/` and the ignored package `pkg/`.
- Compare mutations and dirty sets before DOM cache reconciliation, as the model does.
- Keep saved failing tapes under `packages/lexical-conformance/fixtures/fuzz/`.
