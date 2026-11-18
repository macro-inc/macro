# Document session

## What it is

Portable composition of EditorCore or generic Loro containers with doc_sync_core.
The host supplies identities and both clocks and executes the returned effects.

## Boundaries

- Present newer nonempty application-body documents read-only, rejecting projection and sync readiness for every access level; keep generic/editor-only surfaces independent of application schema versions.

- Route ordinary Up/Down at Editor priority through the existing rich-text movement helpers; leave application stopping and host geometry in the higher-priority fixed block-navigation role, and retain the helper's actual pre-DOM selection points.

- Forward application controller queries through EditorSurface.application_query using only the existing read-only core editor; never expose mutable Core or grant callback reentry.

- Keep storage, transports, timers and identity generation outside this crate.
- Forward snapshot statistics from the actual Loro document without exporting, checking out or changing the requested base.
- Read `last_output` to encode committed effects without processing another input.
- One host input enters the shared handle path once; keep keystrokes inside the append/presence window.
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
- Exclude Root from ordinary application ID transforms and clipboard clearing; preserve imported IDs and generic session Root tracking. The open and separate post-Loro passes mint only a missing Root ID from the shared entropy stream; raw SetState remains unchanged. Preserve the live root ID across incoming root own-field changes, and write it back only with the next real local mutation. Persist post-Loro repairs only for Edit, with the excluded history fix-up origin (C-ROOT-ID-UNDO-01: Source records an ID-only undo step that can remove the stored ID).
- Collaborative builders enable opaque unknown types and disable core snapshot history.
- Deliver explicit Focus inputs when host focus changes; preserve logical selection on blur.
- Register Click at the ordinary rich-text Editor priority and reuse lexical_rich_nodes::rich_text::click; decorator-specific selection remains in component listeners.
- Register ArrowLeft/ArrowRight at the same Editor priority through rich_text::arrow_left/right; run MoveCharacter through modify_selection with RequireView and leave LayoutRequired text movement to the browser.
- Register MoveToStart/MoveToEnd at Editor priority through the existing rich-text helpers; preserve application High word interception and prevent browser defaults only when the helper handles the command.
- Match collaborative registerLoroHistory with Loro’s configured merge interval and the injected host wall clock; keep MergeTracker as the independent group classifier, fed the same wall clock (Source's getMergeAction reads Date.now), without a second session interval override. The monotonic clock never decides history grouping. Standalone lexical-history tests do not define collaborative Session boundaries. Pin immediate structural Undo and cold-reopened Undo separately, since reopening has no earlier local creation entry.
- Checkpoint eligible local projections from their new oplog span instead of document events; retain full events for imports, fixups, paused/excluded edits and undo/redo.
- Drain initial core output before accepting input; rebuild bindings and undo on reset.
- Register Await peer ownership only for MarkdownSync and derive its local bit through the existing Created hooks on open; pass only that selected bit through Initialize, repaint and incremental diffs, without persisting local state or running a blanket ownership pass.
- Forward native decorator observation sidecars even when no serialized property
  operation exists; consuming-view exposure, not model publication, owns signature
  observation revisions.
- Clean persisted transparent wrappers only during writable initialization; use stored editor JSON to retain imported state and protected local fields, and apply initial hooks once.
- Run the load follow-up on every writable application open after the UndoManager exists: project parsed metadata and optional derived search text together, then the queued version upgrade when stale. Skip empty projections and preserve one undo group; read and comment-only opens write nothing. A failed load-refresh projection is reported as FollowUpFailed and the open continues: partial ops are sealed with FIXUP_ORIGIN and the projection is re-attached to the actual document. A missing projection stays fatal.
- Answer a local chain's metadata upgrade request with its own following update in the same drain (Edit only); a failure is reported as a follow-up failure and keeps the triggering edit.
- Never weaken either side of the collab differential or change oracle expectations.

## Checks

- `cargo test -p document_session -j4`
- `cargo test -p document_session --all-features -j2` covers the native bridge and application projection-failure controls; keep these enabled when changing load normalization or recovery.
- `cargo check -p document_session --target wasm32-unknown-unknown -j4`
- `cargo clippy -p document_session --all-targets -j4 -- -D warnings`
- `cargo test -p document_session --no-default-features --features application -j2` checks generic admission with compatibility disabled.
- `cargo test -p document_session --features application,compatibility --lib root_text_cache_test` checks structural root-text reconciliation against the actual Macro registry without adding a public counter API.
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
- `tests/metadata_hydration/table_reopen.rs`: v11 Source-recorded reopen commits, partial delivery, access and no-op controls.
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
Use the production `register_editor_commands` in application formatting integration
controls; a registry-only Macro builder has no core formatting command handlers.
`tests/telemetry.rs` isolates its tracing subscriber from parallel unit callsites.

Common staging exposes same-core unpublished scopes and StagedUpdate in every feature profile. Route its single-consumption admission command through normal handle readiness/access checks; never add it to local_commands. register_editor_commands installs the one generic admission handler for native application builders. The compatibility feature keeps CompatUpdate and old scope names as aliases; compat_editor_builder installs that same handler without native behavior plugins. Recover refused state with recover_unadopted before retrying; adoption alone is not a successful-commit receipt.
Forward late Stop even when the session is already terminal. Its real Stopped reply
acknowledges host Close only after the original terminal WAL barrier completes.


Portable HTML and Markdown exports are available through the typed native FFI.

Enable the application feature to share application_editor_config and application exporters across native and WASM hosts; supply the same clock and continuing per-peer entropy streams, never server composers.
Initialize the editor only after Seeded includes every startup WAL adoption; optimistic and socket seeds must not expose an empty model while durable rows are still being recovered.

For non-browser history, record before/after selection cursors per Loro history group, using the model-accepted inline selection; restore transformed popped cursors after projection binding for undo/redo, headless and focused views. Use the pinned native UndoManager metadata setters to preserve each entry across Loro loop substitution. Keep history metadata local to the session, outside wire bytes.

Run routed history keys through model KeyDown and command listeners first; only successful unhandled Undo/Redo routes fall through to Loro history after listener commits are projected.

Detect duplicate durable IDs only against attached owners; subtree removal may leave stale descendant index entries, and undo/redo must preserve the restored identities.

Application sessions mint Source-shaped `nanoid(8)` ids from the continuing per-peer NodeRandom stream: reserve this commit's attached nonempty incoming ids first, redraw indexed or reserved candidates at most 16 times, then fail the follow-up round (accepted main commit, no ids written). Standalone sessions keep `session-{peer}-{key}`. Tests: `src/editor/runtime_id_test.rs`.

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

For browser MarkdownSync history, clear selection in the historic content update and skip the DOM write. Restore the current local awareness whenever it resolves, even over a null model selection, in a separate selection update, and let actual browser selection changes settle unresolved carets.
Replace the local awareness (and presence) cursor only when the selection converts, as Source's localCursorUpdate does: a table, node or null selection, or a range point outside Loro, keeps the previous cursor.

Preserve filtered importer state in the initial stored comparison while keeping ordinary Source import omissions; readonly initialization must not repair persisted slots merely to attach. Keep qualified imported null indentation in that exact stored comparison and through unrelated projection edits.

Observe checklist candidates from actual accepted/error commit arrays and derive plans only at the sealed final-output epilogue; acknowledge exact receipts only after native host output transfer succeeds.

Forward the default-off `dev-probes` feature only to `lexical_loro/dev-probes`; production native profiles must reject it.

This crate alone enables loro-internal's and lexical_loro's `native-editor` feature, the editor's local Loro runtime changes (vendor/loro-editor/README.md). Never forward it to a crate a server depends on; `just check-loro-native-editor-features` and the native editor feature-graph guard enforce that.

Read the preview/test stored comparison from the current surface core and configured sync policy; do not substitute ordinary JSON queries or a pending read scope.

Forward an opt-in main-commit sink and capture-only typed facts only through the designated local editor application; capture from that actual commit before follow-ups and retain known publication through projection/recovery errors without observing prefix, remote or resync applications. Keep typed Database authority beside the id-only outcome; admission remains in the existing session path.

Complete accepted InsertClipboardNodes through clipboard::insert_nodes_and_update_selection so the resulting caret inherits inserted format and style; keep direct dispatch handled and identity invalidation before insertion.

Keep checklist reader settings in the session producer and stale/local intent
returns before Core dispatch; notify its required sealed access hook only after
the real access cache changes value, preserving equal-value refreshes.

Keep list-indent CI fixtures in tests/corpus/list-item-indent byte-exact to their frozen Source provenance; read approval.json with provenance.json for current approval, and obtain a new freeze review before changing fixture bytes. Use builder.initial_state for stored-load controls and label SetState controls as local pipeline replacements.
