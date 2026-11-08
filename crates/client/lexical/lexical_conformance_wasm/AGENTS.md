# Lexical conformance WASM

## What it is

Development-only raw-model transaction facades for differential conformance.
Never import them from production crates or bundles.

## Start here

- `src/corpus.rs`: owned HTML and portable composer-wire dispatch; I/O-free route adapters with deterministic host inputs and content-free errors; real dev data stays in the external corpus cache.
- `src/gate.rs`: actual Macro gate comparison with explicit deterministic constructor inputs.
- `src/compat.rs`: model-derived format flags and one WASM-instance key counter for shim host allocation/reset; Tier C handles retain their isolated counters.
- `src/lib.rs`: isolated `CoreHandle`, JSON transaction boundary and build identity.
- `src/rich.rs` and `src/rich/input.rs`: rich profile, history, markdown and explicit
  package operations for the external differential harness.
- `src/command.rs`: text/paragraph commands and explicit host-resolved view inputs.
- `src/snapshot.rs`: state, selection, identities and commit records with pre-cache mutations.
- `packages/lexical-conformance/diff/`: loader, reproducible build and JS oracle.

## Boundaries

- Keep `publish = false`, `cdylib` plus `rlib`, and client workspace-hack exclusion.
- Enable the reserved `foreign-nodes` feature only here; WP-54 supplies JS hooks.
- WP-07 uses raw `Editor` transactions. WP-14 replaces v0 JSON commands with
  EditorCore and the session codec. `RichHandle` separately composes the actual
  rich-node, table, clipboard, history and markdown APIs; neither facade
  implements the session codec or Tier B rendering contract.
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
- Run both differential configurations using [the differential guide](../../../../packages/lexical-conformance/diff/README.md); keep their module identities isolated.

## Gotchas

- Build artifacts live in this worktree's `target/` and the ignored package `pkg/`.
- Compare mutations before DOM cache reconciliation and dirty sets from the final commit, matching upstream listeners.
- Keep WP-07 failing tapes under `packages/lexical-conformance/fixtures/fuzz/`.
- Keep the rich differential harness and its failing tapes outside the repository
  under `/home/wolf/tmp/lexical-port/difffuzz`; never copy that harness here.

Rich snapshots retain dangling table selection points with null paths after final row/column deletion.
