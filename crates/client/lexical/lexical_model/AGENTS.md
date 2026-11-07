# Lexical model

## What it is

Portable editor model for the Lexical port. This crate owns values, registered
node types, immutable snapshots, transactional tree editing, update processing, JSON interchange, selection editing directional caret traversal, commands, plugins, history, structural view diffs and EditorCore.

## Start here

- `src/lib.rs` exposes the model API.
- `src/node.rs` defines node kinds, inheritance and dispatch.
- `src/transaction.rs` owns writes; never mutate a committed snapshot.
- `src/pipeline/` implements flush order, normalization, GC and view-attached caches.
- `src/commit.rs` computes mutations before cache writes and atomically publishes snapshots.
- `src/plugin.rs`, `command.rs` and `extension.rs` own dispatch, follow-up rounds and transactional extension state.
- `src/history.rs` owns undo/redo stacks and the standalone merge tracker.
- `src/diff/` owns the versioned flat ABI; keep all 11 opcodes in sync with the independent TS decoder test.
- `src/core/` owns input policy, raw remote edits and host effects.
- `src/caret/` implements directional positions, eager cursors, range removal and splitting.
- `src/json.rs` preserves export order and JavaScript number serialization.

## Boundaries

- Pure Rust model; no network, database, runtime or browser dependencies.
- Client crate: keep it excluded from workspace-hack through `crates/client/*`.
- Selection slots, formatting and range edits preserve upstream active-versus-detached selection side effects.
- Movement consumes explicit host points; `NoView` runs structural rules only.
- Optional `model-segmentation` enables Unicode movement within text nodes; visual line boundaries still require host layout.
- Caret cursors compute successors before returning items; keep the construction-time first step.
- Commands visit registered listeners only; external dispatch flushes between levels, inline dispatch does not.
- Hooks share one follow-up transaction per round and stop at 99 rounds; extension state rolls back with updates.
- History restores snapshots without rerunning transforms; diffs compare descendant map entries even when ancestor records are shared.
- EditorCore is sans-IO: host time, layout, clipboard and composition facts arrive as data; effects leave as values.
- Failed hook rounds roll back early publications too; failed main inputs retain and report their early commits.

## Checks

- `cargo test -p lexical_model -j4`
- `cargo test -p lexical_model --all-features -j4`
- `cargo check -p lexical_model --all-features --target wasm32-unknown-unknown -j4`
- `cargo clippy -p lexical_model --all-targets -j4 -- -D warnings`
- `cargo test -p lexical_conformance --test flat_diff -j4` (requires Bun for the independent decoder)
- `cargo tree -p lexical_model --target wasm32-unknown-unknown -i workspace-hack`
- `cargo x deps --check`, `cargo shear`, `just check`

## Gotchas

- Text positions are UTF-16 code units; reject surrogate-splitting offsets.
- Node ancestry follows the kind trait's `Parent`, never Rust layout casts.
- Keep key allocation outside rollback, and snapshots independent on first write.

## Tests

- Cover every public function with an explicit literal behavior test before adding table-driven or generated cases; do not hide fixture construction behind a helper DSL.
- Test pipeline order, rollback, JSON bytes and boundary cases locally; replay the admitted Tier A core subset with `cargo test -p lexical_conformance --test replay -j4`.

The sibling test modules cover values, reads, node dispatch, tree edits and NodeState.
`pipeline/test.rs` covers ordering and transaction boundaries; `json/test.rs` checks
literal exported bytes. `selection/*/test.rs` and `selection/test.rs` port explicit
upstream selection examples, including the §18.5 `remove_text` fixture, detached-slot
side effects, UTF-16 boundaries, formatting, block deletion and host movement.

Root text-cache reconciliation clones its record after mutation reporting and retains
the intentional root dirty mark; cache-only writes do not add mutations.
