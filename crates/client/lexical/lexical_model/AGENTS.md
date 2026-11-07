# Lexical model

## What it is

Portable editor model for the Lexical port. This crate owns values, registered
node types, immutable snapshots, transactional tree editing, update processing, JSON interchange, selection editing and directional caret traversal.

## Start here

- `src/lib.rs` exposes the model API.
- `src/node.rs` defines node kinds, inheritance and dispatch.
- `src/transaction.rs` owns writes; never mutate a committed snapshot.
- `src/pipeline/` implements flush order, normalization, GC and view-attached caches.
- `src/command.rs` owns listener ordering and reentrant dispatch; `src/extension.rs` stages per-editor state separately from document snapshots.
- `src/commit.rs` computes mutations before cache writes and atomically publishes snapshots.
- `src/caret/` implements directional positions, eager cursors, range removal and splitting.
- `src/json.rs` preserves export order and JavaScript number serialization.

## Boundaries

- Pure Rust model; no network, database, runtime or browser dependencies.
- Client crate: keep it excluded from workspace-hack through `crates/client/*`.
- Direct splice/append moves preserve source element offsets for explicit package remapping; insert-before/after and replace adjust source offsets.
- Use `replace_selection` when a package allocates a new selection object; point mutations preserve the active object identity.
- Selection slots, formatting and range edits preserve upstream active-versus-detached selection side effects.
- Movement consumes explicit host points; `NoView` runs structural rules only.
- Optional `model-segmentation` enables Unicode movement within text nodes; visual line boundaries still require host layout.
- Typed selection-change and application commands use immutable plugins and transactional extension state.
- Stock editing-command registration, History, follow-up hooks and view diffs remain later layers.
- Caret cursors compute successors before returning items; keep the construction-time first step.

## Checks

- `cargo test -p lexical_model -j4`
- `cargo test -p lexical_model --all-features -j4`
- `cargo check -p lexical_model --all-features --target wasm32-unknown-unknown -j4`
- `cargo clippy -p lexical_model --all-targets -j4 -- -D warnings`
- `cargo tree -p lexical_model --target wasm32-unknown-unknown -i workspace-hack`
- `cargo x deps --check`, `cargo shear`, `just check`

## Gotchas

- Text positions are UTF-16 code units; reject surrogate-splitting offsets.
- Text insertion checks the adjacent text node's insertion edge before reusing it; tabs and entity boundaries require a new plain text node.
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

Element text-cache changes retain intentional dirty marks after mutation reporting; splice only rewrites changed sibling links.

Root text-cache reconciliation clones its record after mutation reporting and retains
the intentional root dirty mark; cache-only writes do not add mutations.
