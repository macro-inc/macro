# Document session

## What it is

Portable composition of EditorCore or generic Loro containers with doc_sync_core.
The host supplies identities and both clocks and executes the returned effects.

## Boundaries

- Forward application controller queries through EditorSurface.application_query using only the existing read-only core editor; never expose mutable Core or grant callback reentry.

- Keep storage, transports, timers and identity generation outside this crate.
- Forward snapshot statistics from the actual Loro document without exporting, checking out or changing the requested base.
- Read `last_output` to encode committed effects without processing another input.
- One host input calls `handle` once; keep keystrokes inside the append/presence window.
- SyncCore owns WAL, catch-up, flush, reset, access and comment delivery policy.
- Use `EditorSurface::view_diff` for a cold repaint without resetting sync/history.
- Surface imports queue view effects in the same output as their sync input.
- Restore headless remote cursors through the private model-selection command;
  keep rejecting view-selection inputs in headless EditorCore.
- Resolve awareness cursors against the live projection; publish changed point sets
  after local/remote edits and clear them on expiry without exposing native handles.
- Hold composing-paragraph remote imports only in the live editor; keep the canonical
  sync/WAL/ack document current and publish local IME edits immediately. End the
  hold at composition end, 3 seconds or 64 new imports; merge through Loro.
- Use the supplied editor factory for live editors and headless comment forks.
  Supply its matching comment-node constructor for fresh-peer staging; the default
  creates MarkNode. Application registry/policy wiring belongs to macro_document_model.
- Install register_editor_commands when the application owns identity registration,
  or pass the importer's exact StateKey<Option<String>> to
  with_session_plugins_with_id_state. Never install another key named id in that
  registry. default_editor_builder retains standalone identities and its private key.
- Collaborative builders enable opaque unknown types and disable core snapshot history.
- Deliver explicit Focus inputs when host focus changes; preserve logical selection on blur.
- Register Click at the ordinary rich-text Editor priority and reuse lexical_rich_nodes::rich_text::click; decorator-specific selection remains in component listeners.
- Loro owns undo with merge_interval 0; MergeTracker and injected time own grouping. Preserve its structural and explicit-push boundaries; never turn a classified Push into Merge using a second elapsed-time window.
- Checkpoint eligible local projections from their new oplog span instead of document events; retain full events for imports, fixups, paused/excluded edits and undo/redo.
- Drain initial core output before accepting input; rebuild bindings and undo on reset.
- Forward native decorator observation sidecars even when no serialized property
  operation exists; consuming-view exposure, not model publication, owns signature
  observation revisions.
- Clean persisted transparent wrappers only during writable initialization; retain protected local fields and apply initial hooks once.
- Verify metadata-free opens against unchanged Loro versions and no WAL/document-update frames; include metadata in the first edit’s normal coalesced WAL without an extra metadata input.
- Never weaken either side of the collab differential or change oracle expectations.

## Checks

- `TMPDIR=/home/wolf/tmp cargo test -p document_session -j4`
- `TMPDIR=/home/wolf/tmp cargo check -p document_session --target wasm32-unknown-unknown -j4`
- `TMPDIR=/home/wolf/tmp cargo clippy -p document_session --all-targets -j4 -- -D warnings`
- `TMPDIR=/home/wolf/tmp cargo test -p document_session --no-default-features --features application -j2` checks generic admission with compatibility disabled.
- Inspect `cargo tree -p document_session --no-default-features --features application --target wasm32-unknown-unknown -e normal,build --format '{p} {f}'` and reject `workspace-hack`, `foreign-nodes` or `compatibility` in the native production closure.
- `cargo x deps --check`, `cargo shear`, `just check`, `just pr-privacy`

## Gotchas

Set peer immediately on every new/forked document and disable recorded timestamps.
Admit TextDeltaFromView on the held IME branch before releasing queued remote updates; full TextFromView remains an explicit resync input.
Project early commits even when apply fails; consume buffered remote events only after
successful binding. Validate complete generic batches before changing the live document.

## Start here

- `src/session.rs`: shared lifecycle, SyncDoc lending adapter and ordered output drain.
- `src/editor.rs`: initialization, remote repair and deterministic Loro grouping.
- `src/editor/builder.rs`: default registry, command handlers and persistent node-id index.
- `src/editor/identity_test.rs`: complete subtree-history JSON, durable identities, caret restoration and typed root metadata regressions.
- `src/editor/id_state_test.rs`: supplied-key code snapshot/fresh-load round trip and strict rejection of distinct state keys named id.
- `src/generic/validate.rs`: semantic shadow validation before any native operation.
- `src/generic/surface.rs`: native event collection and observed-path replacement handling.
- `src/comments.rs`: fresh-peer mark staging and idempotent publication retries.
- `src/observation.rs`: conformance-only text/node identities around real undo/redo.
- `examples/collab.rs`: development-only native bridge for the four-peer differential.
- `benches/bulk.rs`: load-guarded native JSON and Markdown measurements on the synthetic S/M/L seeds; see `benches/README.md` for scope and comparison commands.

The `conformance` feature only enables read-only inspection and the development
example. It is not an application API or a wire/session ABI.
The separate `test-faults` feature injects malformed local serialization for the
simulation; never enable it in a shipped artifact. It exposes receipts, not a
mutable document handle.
Conformance hosts can inspect immutable SyncCore diagnostics, actual sync/import
observations, actual undo/redo removals before projection repair, and independent
reconstructed editor state. Missing/uninspectable identities invalidate conformance;
record that failure without interrupting the real undo/recovery flow.
Draining effects retains
the pending timer; no mutable Loro document handle escapes.

Run the current TS stack differential from the repository root:
`bunx vitest run --config packages/lexical-conformance/diff/collab.config.mts`.
Run `cargo test -p document_session --all-features -j4` for the native bridge too.
`tests/telemetry.rs` isolates its tracing subscriber from parallel unit callsites.

Common staging exposes same-core unpublished scopes and StagedUpdate in every feature profile. Route its single-consumption admission command through normal handle readiness/access checks; never add it to local_commands. register_editor_commands installs the one generic admission handler for native application builders. The compatibility feature keeps CompatUpdate and old scope names as aliases; compat_editor_builder installs that same handler without native behavior plugins. Recover refused state with recover_unadopted before retrying; adoption alone is not a successful-commit receipt.
Forward late Stop even when the session is already terminal. Its real Stopped reply
acknowledges host Close only after the original terminal WAL barrier completes.


Portable HTML and Markdown exports are available through the typed native FFI.

Enable the application feature to share application_editor_config and application exporters across native and WASM hosts; supply the same clock and continuing per-peer entropy streams, never server composers.
Initialize the editor only after Seeded includes every startup WAL adoption; optimistic and socket seeds must not expose an empty model while durable rows are still being recovered.

Record before/after selection cursors per Loro history group, using the model-accepted inline selection; restore transformed popped cursors after projection binding for undo/redo, headless and focused views. Use the pinned native UndoManager metadata setters to preserve each entry across Loro loop substitution. Keep history metadata local to the session, outside wire bytes.

Run routed history keys through model KeyDown and command listeners first; only successful unhandled Undo/Redo routes fall through to Loro history after listener commits are projected.

Detect duplicate durable IDs only against attached owners; subtree removal may leave stale descendant index entries, and undo/redo must preserve the restored identities.

Recover an unadopted compatibility update through CompatUpdate::recover_unadopted
when normal readiness/access policy refuses it; preserve its exact pending state
for a later caller decision. Recovery is single-consumption and does not roll back
an adopted update or a published transition. Check publication receipts separately.

Use EditorConfig.namespace for both rich paste and clipboard export; application MarkdownSync uses the source document namespace, while portable standalone sessions retain their configured default.

Invalidate the injected durable ID key recursively at Critical/Before InsertClipboardNodes and yield to insertion handlers; never invalidate snapshot/remote imports or history restoration. Cross-document JSON/HTML, repeated paste, destination identity and exact undo/redo controls live in src/editor/clipboard_id_test.rs.

Read current effective access through effective_access, which delegates to SyncCore; never infer it from construction or UI flags. Treat it as observation only and keep normal handle admission checks after queued permission changes.

Route `PreparedAdmission` through the same generic admission handler and normal
`handle` readiness/access checks. Recover the exact capsule only before adoption;
an adopted update without a main-publication receipt is fatal, while a published
update whose output fails must never be retried. The prepared snapshot is the
sealed main transition; paste parity and completion inspect the drained correction
chain and ordinary history grouping. Recheck the host's durable-state generation
separately before admission: the model publication epoch cannot detect canonical
Loro advancement. These APIs do not activate asynchronous paste or grant a scope
that may survive an await.

Pin application ROOT nested-state order against literal Source exports through both direct and fast JSON paths; keep raw fixtures intact and leave unknown-key and non-application defaults unchanged.

Keep ordinary host listener registration behind the specialized EditorSurface session forwarders, and rebind from actual presence after core replacement. Associate reported typed errors with their exact view-effect push through the optional metadata observer; caught nested callback failures are not reported outer errors.
