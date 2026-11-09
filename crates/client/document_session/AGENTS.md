# Document session

## What it is

Portable composition of EditorCore or generic Loro containers with doc_sync_core.
The host supplies identities and both clocks and executes the returned effects.

## Boundaries

- Keep storage, transports, timers and identity generation outside this crate.
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
- Install register_editor_commands when the application owns identities; use
  with_session_plugins for session identity tracking over a supplied registry.
- Collaborative builders enable opaque unknown types and disable core snapshot history.
- Deliver explicit Focus inputs when host focus changes; preserve logical selection on blur.
- Loro owns undo with merge_interval 0; MergeTracker and injected time own grouping.
- Drain initial core output before accepting input; rebuild bindings and undo on reset.
- Clean persisted transparent wrappers only during writable initialization; retain protected local fields and apply initial hooks once.
- Never weaken either side of the collab differential or change oracle expectations.

## Checks

- `TMPDIR=/home/wolf/tmp cargo test -p document_session -j4`
- `TMPDIR=/home/wolf/tmp cargo check -p document_session --target wasm32-unknown-unknown -j4`
- `TMPDIR=/home/wolf/tmp cargo clippy -p document_session --all-targets -j4 -- -D warnings`
- `cargo tree -p document_session --target wasm32-unknown-unknown -i workspace-hack`
- `cargo x deps --check`, `cargo shear`, `just check`, `just pr-privacy`

## Gotchas

Set peer immediately on every new/forked document and disable recorded timestamps.
Project early commits even when apply fails; consume buffered remote events only after
successful binding. Validate complete generic batches before changing the live document.

## Start here

- `src/session.rs`: shared lifecycle, SyncDoc lending adapter and ordered output drain.
- `src/editor.rs`: initialization, remote repair and deterministic Loro grouping.
- `src/editor/builder.rs`: default registry, command handlers and persistent node-id index.
- `src/generic/validate.rs`: semantic shadow validation before any native operation.
- `src/generic/surface.rs`: native event collection and observed-path replacement handling.
- `src/comments.rs`: fresh-peer mark staging and idempotent publication retries.
- `src/observation.rs`: conformance-only text/node identities around real undo/redo.
- `examples/collab.rs`: development-only native bridge for the four-peer differential.

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

The compatibility feature exposes same-core unpublished host scopes and a single-consumption adoption command. Route it through normal handle readiness/access checks; never add the extension command to local_commands. compat_editor_builder installs only that admission handler, without native behavior plugins.
