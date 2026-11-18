# Lexical Loro projection

## What it is

Portable incremental projection between lexical_model commits and Loro 1.17.1.
It preserves the persisted loro-mirror node schema and takes explicit clocks.

## Start here

- `src/golden.rs`, `mirror.rs`, `snapshot.rs`: frozen ancestor and server snapshot reconciliation.
- `reconstruct_initial_state`: one read-only walk reports persisted transparent wrappers; `mirror::set_synced_state` performs explicit full cleanup with protected local fields retained.
- `src/policy.rs`: synced editor view and application exclusions.
- `src/schema.rs`: fresh/existing container inference and text splicing.
- `src/local.rs`, `child_index.rs`: dirty projection, stable direct-child insertion anchors and corrected list moves; local_commit_without_events (optional `native-editor` feature, enabled only by document_session) suppresses materialization only at the final commit, and its owner must checkpoint undo from local operations.
- Move paired old/new JSON capacities out of the projection before invoking model exports; keep callback order and apply the same storage normalization/undefined-field policy on every export.
- `src/remote.rs`: buffered Loro events and id-keyed raw editor changes.
- `src/cursor.rs`: Unicode/UTF-16 conversion and awareness cursor codec.

## Boundaries

- Keep application node types, canonical editor serialization and ownership policy behind SyncPolicy.
- Project load-time retained-state normalization and derived search text in the same refresh commit, before a separately queued schema upgrade.
- Require explicit SyncPolicy permission for null own text during read and binding; retain null unchanged and reject every other malformed text value.
- Keep canonical editor aliases separate from source own-undefined storage encoding; compare canonical reads strictly and retain every underlying Loro value and operation.
- Apply ComparisonKind only to model-versus-Loro comparisons after dropped/transparent projection; keep writer serialization unchanged, reread changed child fields during incremental checks, and preserve real incoming raw cache updates.
- Apply source own-undefined storage fields through SyncPolicy before writing; retain strict attach equality and keep PlainPolicy unchanged.
- Compare and write the model's stored NodeState representation; a read memo must not change attach, verification or persisted fields. Keep public synced JSON export canonical and own-undefined placeholders exclusive to writers. Pass policy-selected nested root state through live reconciliation with its actual stored presence.
- Verify client Loro 1.17.1 separately from the server's JavaScript `loro-crdt` (sync-service's own pin) in the pair test.
- No network, database, async runtime or host callbacks; native Loro subscription only.
- Set peer immediately after new/fork; disable live-session recorded timestamps and pass commit timestamps.
- Retain recorded timestamps only in server-created snapshot helpers; never regenerate the frozen Markdown ancestor.
- Treat empty snapshot IDs as unkeyed; match source insertion and duplicate retention.
- Compute snapshot list move sources after deletions and preserve surviving container identities.
- Never enable loro-internal's wasm feature; native Loro positions are Unicode scalars.
- WASM builds of Loro itself require a JavaScript host for its internal clock.
- Preserve inference/container kinds, foreign children and unexported fields.
- Validate the full deep node state before extracting its string ID during binding; avoid constructing serde JSON just to read the ID, and keep validation before index mutation.
- Compute composite flags during ownership indexing and count newly handled descendants in that same walk; do not reread each map or traverse a new subtree just for metrics.
- Keep client crate excluded from workspace-hack.

## Checks

Install root Bun dependencies before running tests; the differential oracle must
run the current mirror source and must never be replaced with expected values.
The editor pair uses Rust Loro 1.17.1; the Worker transcript driver uses
sync-service's own `loro-crdt` beside the workspace 1.17.1 server encoder, and the
committed transcript bytes were recorded with 1.16.3.


- `cargo test -p lexical_loro -j4` (servers' feature-off build) and `cargo test -p lexical_loro --features native-editor -j4` (the session's).
- `PROPTEST_CASES=256 cargo test -p lexical_loro -j4`
- `cargo check -p lexical_loro --target wasm32-unknown-unknown -j4`
- `cargo clippy -p lexical_loro --all-targets -j4 -- -D warnings`
- `cargo x workflows --check` after changing the generated `loro-pair` job.
- `cargo x deps --check`, `cargo shear`, `just check`, `just pr-privacy`

## Gotchas

Use explicit literal tests before generated differential streams. Application-specific plugins stay in macro_document_model; history grouping is
WP-49. Keep literal tests for each intentional S11 delta. Strict checks must
report unrepresentable newer own fields while preserving them in Loro.
Use saved event paths for unindexed filtered wrappers; reconcile final policy
visibility before emitting updates or retaining their model bindings.

Remote Create JSON retains an empty children marker for native elements so
opt-in unknown types keep their structural kind through EditorCore.

Trust direct-child insertion anchors only for the exact previous editor snapshot and unchanged native oplog/state, with no pending writes; invalidate them on external edits, checkout, fixups or projection failure. Keep full checks independent and use general reconciliation for wrappers, foreign children, removals and moves.

Snapshot ownership of affected child lists before initializing new subtrees;
rebinding a moved descendant must not turn its old container into a foreign child.

Local projection uses debug metrics without per-keystroke tracing spans; cold session
flows own the parent spans.

Resolve transformed undo cursors through the current text/children container owner; recreated history nodes cannot be located with stale model keys or metadata node IDs.

Write load-time derived root search text with refresh_root_search_text (the same writer, no model update); as the first local projection after attach it also carries the pending stored-drift rewrites. Every Loro read for comparison or import (tree reads, incremental checks, remote fields and creates) applies SyncPolicy::normalize_stored with the stored synced parent, so attach stays strict modulo Source's import normalization; it must change only stored_normalized_fields. Track stored_drift: nodes whose stored own fields differ from that normalization, filled after attach (full scan, counted on state.load) and, after a remote or history import, for the nodes whose own maps it touched or created (RemoteChanges::touched, counted on doc.stored_drift.rescan). Each local projection writes the normalized value of each drifted field (a delete when it is unset) unless the commit changed that field, and never re-inserts a normalized field as null where Loro lacks it, while a container's own fresh null slots stay. Project ROOT's own fields when a chain commit carries stored_state_superseded. For opt-in root search text, bind authored expectations to the actual stored container after successful local projection. Derive from the last direct root element for each durable ID, apply to matching serialized root children, and retire on actual remote field import or container retirement. History and fixup consume existing storage without deriving.

Persist SyncPolicy::local_state_keys (per-peer derived state) as the model's value, lazily. Track nodes whose model value differs from storage (rebuilt at attach, refreshed for every projection's candidates), and write only those keys at the next ordinary LOCAL projection. Never write them in FIXUP projections or chains made only of local_state_update_tag commits, which Source does not sync. Every read and comparison still masks them, so the receiver derives its own bit (C-PEER-LOCAL-REMOTE-CREATE-01: on remote create too, where Source keeps the writer's value).

Keep `dev-probes` default-off and restricted to preview/test inspection; production native feature graphs must reject it.

Keep `test-faults` default-off and simulation-only: it fails a projection after a set number of own-field writes, so callers can test recovery from partial writes. Only document_session's `test-faults` enables it; never ship it.

Use feature-gated `stored_comparison` only for the exact projection comparison policy; it forwards `comparison::model` and is neither ordinary public export nor raw Loro JSON.

- Classify derived remote indentation once through SyncPolicy; retain raw local values on Update, use constructor raw defaults for numeric Create values, preserve absent/null slots, and count final-tree depth mismatches per batch without claiming restructuring parity.
