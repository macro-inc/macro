# Lexical model

## What it is

Portable editor model for the Lexical port. This crate owns values, registered
node types, immutable snapshots, transactional tree editing, update processing, JSON interchange and selection editing.

## Start here

- `src/lib.rs` exposes the model API.
- `src/node.rs` defines node kinds, inheritance and dispatch.
- `src/selection/caret.rs` implements directional caret range deletion.
- `src/transaction.rs` owns writes; never mutate a committed snapshot.
- `src/pipeline/` implements flush order, normalization, GC and view-attached caches.
- `src/commit.rs` computes mutations before cache writes and atomically publishes snapshots.
- `src/json.rs` preserves export order and JavaScript number serialization.

## Boundaries

- Pure Rust model; no network, database, runtime or browser dependencies.
- Client crate: keep it excluded from workspace-hack through `crates/client/*`.
- Selection slots, formatting and range edits preserve upstream active-versus-detached selection side effects.
- Movement consumes explicit host points; `NoView` runs structural rules only.
- Optional `model-segmentation` enables Unicode movement within text nodes; visual line boundaries still require host layout.
- View diffs and command dispatch remain later layers.
- Reserved `foreign-nodes` exposes a development-only peer editor for the conformance facade; JS node hosting remains a later layer.

## Checks

- `cargo test -p lexical_model -j4`
- `cargo test -p lexical_model --all-features -j4`
- `cargo check -p lexical_model --all-features --target wasm32-unknown-unknown -j4`
- `cargo clippy -p lexical_model --all-targets -j4 -- -D warnings`
- `cargo tree -p lexical_model --target wasm32-unknown-unknown -i workspace-hack`
- `cargo x deps --check`, `cargo shear`, `just check`

## Gotchas

- Text positions are UTF-16 code units; allow interior selection offsets but reject edits that split surrogate pairs.
- Node ancestry follows the kind trait's `Parent`, never Rust layout casts.
- Keep key allocation outside rollback, and snapshots independent on first write.

## Tests

- Cover every public function with an explicit literal behavior test before adding table-driven or generated cases; do not hide fixture construction behind a helper DSL.
- Test pipeline order, rollback, JSON bytes and boundary cases locally; the independent Tier C lockstep lives in `packages/lexical-conformance/diff/`.

The sibling test modules cover values, reads, node dispatch, tree edits and NodeState.
`pipeline/test.rs` covers ordering and transaction boundaries; `json/test.rs` checks
literal exported bytes. `selection/*/test.rs` and `selection/test.rs` port explicit
upstream selection examples, including the §18.5 `remove_text` fixture, detached-slot
side effects, UTF-16 boundaries, formatting, block deletion and host movement.
