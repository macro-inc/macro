# Lexical model

## What it is

Portable editor model for the Lexical port. This crate owns values, registered
node types, immutable snapshots, transactional tree editing, update processing, JSON interchange, selection editing directional caret traversal, commands, plugins, history, structural view diffs and EditorCore.

## Start here

- `src/lib.rs` exposes the model API.
- `src/node.rs` defines node kinds, inheritance and dispatch.
- `src/selection/caret.rs` implements directional caret range deletion.
- `src/transaction.rs` owns writes; never mutate a committed snapshot.
- `src/pipeline/` implements flush order, normalization, GC and view-attached caches.
- `src/commit.rs` computes mutations before cache writes and atomically publishes snapshots.
- `src/plugin.rs`, `command.rs` and `extension.rs` own dispatch, follow-up rounds and transactional extension state.
- `src/history.rs` owns undo/redo stacks and the standalone merge tracker.
- `src/diff/` owns the versioned flat ABI; keep all 11 opcodes in sync with the independent TS decoder test.
- `src/core/` owns input policy, raw remote edits and host effects.
- `src/caret/` implements directional positions, eager cursors, range removal and splitting.
- `src/test/proptest.rs` checks generated scripts against independent link, cache, JSON, mutation and view-diff invariants.
- `benches/node_map.rs` measures isolated writes and full keystrokes at three document sizes; read `benches/README.md` before interpreting timings.
- `src/json.rs` preserves export order and JavaScript number serialization.
- Reuse `json::js_string` and `json::js_to_number` for JSON boundary coercions; JSON.stringify is a different operation.
- `src/style/css.rs` is the shared ordered JavaScript CSS parser for selections and HTML export.

## Boundaries

- Keep parse_editor_state strict; parse_editor_state_report exposes partial state and its diagnostic only to hosts that choose a logging error policy.
- Require equivalent NodeState on both text neighbors before normalization merges them, including absent versus populated state.
- Preserve optional StateValue inner identity and imported undefined text fields through paragraph exports.

- Preserve owning-package extension callback errors in Error::Extension; never classify them as unrelated model failures.
- Use Error::invariant for runtime diagnostic context; static and owned messages display verbatim and share the Invariant classification.
- Use NodeType::create_default for context-dependent constructors; default_node and flag probes remain pure data.
- Pure Rust model; no network, database, runtime or browser dependencies.
- Client crate: keep it excluded from workspace-hack through `crates/client/*`.
- Use `replace_selection` when a package allocates a new selection object; point mutations preserve the active object identity.
- TableSelection::set changes keys while preserving point offsets/kinds and dirties only changed keys, retaining any existing dirty mark.
- Text replacement uses upstream node-based removal across every block type; caret deletion has different shadow-root semantics.
- Use base parent splices for sibling insertion and replacement; element append retains virtual splice dispatch.
- Clamp element offsets during caret reads while retaining the stored selection points.
- Node removal relocates affected points to adjacent sibling element boundaries without descending into their text.
- Selection slots, formatting and range edits preserve upstream active-versus-detached selection side effects.
- Movement consumes explicit host points; `NoView` runs structural rules only.
- Optional `model-segmentation` enables Unicode movement within text nodes; visual line boundaries still require host layout.
- Read SharedKeyCounter::last_allocated when a host must observe temporary allocations without retaining nodes.
- Borrow committed leaf identities through DirtyLeaves; selected tabs remain atomic during range replacement.
- Stage plugin notifications with `emit`; consume typed events from a successful Commit, never call host callbacks inside transforms.
- Typed selection-change and application commands use immutable plugins and transactional extension state.
- Caret cursors compute successors before returning items; keep the construction-time first step.
- Commands visit registered listeners only; external dispatch flushes between levels, inline dispatch does not.
- Hooks share one follow-up transaction per round and stop at 99 rounds; extension state rolls back with updates.
- `StateRef::export_text_slice` exports changed clipboard text through ephemeral clone and export hooks without mutating snapshots.
- `Transaction::restore_editor_state` clones snapshot records, preserves composition and staged dirty sets, and permits further writes; `set_editor_state` seals instead.
- Publish event-only commits without advancing the history merge clock; history records only document or selection changes.
- History restores snapshots without rerunning transforms; diffs compare descendant map entries even when ancestor records are shared.
- EditorCore is sans-IO: host time, layout, clipboard and composition facts arrive as data; effects leave as values.
- Failed hook rounds roll back early publications too; failed main inputs retain and report their early commits.

- Reserved `foreign-nodes` exposes development-only peer editors and fresh seeded-state restoration (explicit key layout, validated selection, next allocator key) for the conformance facade; JS node hosting remains a later layer.

- Structural deletion and movement traverse directional carets before consuming host layout targets; direct child blocks are not adjacent block boundaries.
- Block insertion compares captured writability when upstream checks node object identity.

## Checks

- `cargo test -p lexical_model -j4`
- `cargo test -p lexical_model --all-features -j4`
- `PROPTEST_CASES=256 cargo test -p lexical_model proptest -j4`
- `cargo bench -p lexical_model --bench node_map -j4` (release performance checkpoint)
- `cargo check -p lexical_model --all-features --target wasm32-unknown-unknown -j4`
- `cargo clippy -p lexical_model --all-targets -j4 -- -D warnings`
- `cargo test -p lexical_conformance --test flat_diff -j4` (requires Bun for the independent decoder)
- `cargo tree -p lexical_model --target wasm32-unknown-unknown -i workspace-hack`
- `cargo x deps --check`, `cargo shear`, `just check`

## Gotchas

- Text positions are UTF-16 code units; allow interior selection offsets but reject edits that split surrogate pairs.
- Text insertion checks the adjacent text node's insertion edge before reusing it; tabs and entity boundaries require a new plain text node.
- Node ordering is post-order within shared ancestry, including detached subtrees.
- Node ancestry follows the kind trait's `Parent`, never Rust layout casts.
- Keep key allocation outside rollback, and snapshots independent on first write.

## Tests

- Cover every public function with an explicit literal behavior test before adding table-driven or generated cases; do not hide fixture construction behind a helper DSL.
- The independent Tier C lockstep lives in `packages/lexical-conformance/diff/`.
- Test pipeline order, rollback, JSON bytes and boundary cases locally; replay the admitted Tier A core subset with `cargo test -p lexical_conformance --test replay -j4`.

The sibling test modules cover values, reads, node dispatch, tree edits and NodeState.
`pipeline/test.rs` covers ordering and transaction boundaries; `json/test.rs` checks
literal exported bytes. `selection/*/test.rs` and `selection/test.rs` port explicit
upstream selection examples, including the §18.5 `remove_text` fixture, detached-slot
side effects, UTF-16 boundaries, formatting, block deletion and host movement.

Root text-cache reconciliation clones its record after mutation reporting and retains
the intentional root dirty mark; cache-only writes do not add mutations.

Generate command scripts with inline paragraph contents and block decorators at root; malformed nested paragraphs can legitimately reject insertion upstream. Check range-only command preconditions after decorator deletion enters NodeSelection, and validate selected node keys too.

Generated properties cover S4 P1–P13 for the core node subset. P5 follows S1 §8.6
cache eligibility; P10 compares dirty records before cache writes per S1 §8.7.
Exact history JSON identity (P11) uses headless mode: restoring view-attached
snapshots can reconcile cached element defaults, as the upstream literal guard
demonstrates. Place P14 markdown round-trip properties in lexical_markdown. Persist shrinking seeds in
`proptest-regressions/`. Keep the decorator count in sync with record insertion
and removal; opaque text hooks rule out the local root-text proof.

Cache range direction only when upstream calls isBackward in a write context; invalidate it on endpoint changes and selection-object cloning, while preserving it through text-only trimming.
Collaborative callers opt into `opaque_unknown_types(true)`; strict import stays
the default. Opaque records keep original type/version and own JSON, while framework
links own children. Own export stays flat and overlays changed framework fields.

Opaque future framework enum values round-trip unchanged. Apply source import rules to known fields; unknown element-format strings default through the source lookup.
Copy only own fields when importing opaque elements; never recursively clone children.

Expose immutable event names and the DirtyLeaves alias to boundary and post-commit adapters;
keep typed event payload ownership in the plugin registry.
