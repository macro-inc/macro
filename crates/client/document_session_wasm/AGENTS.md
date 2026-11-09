# Document session WASM

## What it is

The production cdylib for portable editor and generic document sessions.
The generated Bebop schema and flat Diff stream are the only cold wire contract.
Hot editor inputs use wasm-bindgen primitives and reject lone UTF-16 surrogates.
TextFromView text and selection corrections share the final nonzero-output decision; either correction must carry the other final model facts for submitted ranges.
TextFromView returns zero only for an exact accepted DOM edit; all other outcomes
include authoritative text or full view repair, including permission rejection,
stale/non-text keys and malformed UTF-16. A cold `initialize` rebuilds only the
view. SelectionFromView likewise returns zero only for accepted points matching
final model selection; nonzero or normalized/rejected inputs carry authoritative
selection. The view caches those facts while honoring skip-dom-selection tags.
ABI major 2 includes static type predicate flags and initialize markers.
View effect kind 9 ends native composition before a bounded remote hold is painted.
Kind 10 replaces remote cursors: a flag=true marker clears the set, followed by
point selections with peer key/color in keys[0]/keys[1].
Kind 11 carries commit tag names in keys for view commit listeners.
Composition kind 2 clears ownership without admitting DOM text; the view owns
Android event timing and the 30 ms re-clear. Cold EditorCommand b=1 clears
composition at the supplied selection before executing the command in one input;
b=0 preserves composition. EditorKeyDown carries the layout target through
normal KeyDown listener dispatch before the routed deletion. Primitive keyDown
inputs dispatch recognized key-specific listeners after generic KeyDown without
claiming the browser default unless a handler consumes it.

Application command envelopes carry the mirror generation and an optional
keyboard event; reject stale generations before decoding typed surface commands.
Use clipboard kind 2 for complete block-drag subtrees; retain ordinary node-selection copy semantics for kinds 0 and 1.
Use the surface decoder and key-default policy tables so migration groups append registrations independently; table-key routes let model effects decide browser prevention.
Route application bulk reads through query kind 9 with the mirror generation in flags and a name/data JSON envelope in text; reject retired generations and unknown names.

## Start here

- Generate native payload field IDs and both descriptor tables from pinned class ASTs with generate-native-fields.ts; synchronize ordinary JS properties through explicit native projections, not replacement accessors.
- `abi/foreign-host.bop`: production JS class/record/clone/opaque-value metadata; generate both languages with packages/collaboration/scripts/generate-foreign-host-schema.ts. Keep JS values editor-local in opaque slots and node/selection/state references typed. Clone acknowledgements verify tree links and apply only validated base/native patches to the destination; retain instance owner namespaces across editor-state transfers. Keep public export acknowledgements opaque and serialized export acknowledgements explicit; root cached text is derived metadata rather than a native payload field.
- Emit foreign render metadata through ForeignRenderBatch alongside the unchanged flat eleven-op Diff; captureId identifies an exact host-scoped owned capture, never an allocator address. Deliver state/instance-only changes even when no flat operation exists, and hydrate unbound records before JS rendering.
- `abi/session.bop`: authoritative ABI, generated constants and messages.
- `src/machine.rs`: clocks, lifecycle and one handle call per input.
- `src/macro_editor.rs`: application MarkdownSync surface preset/policy, input clock and continuing per-peer constructor entropy for `EditorSession.createMacro`; group plugin registration lives in macro_document_model/src/surface.rs.
- Serialize application PluginEvent payloads through surface.rs group encoders into the existing editor-effect envelope; never perform host I/O in the model.
- `src/output.rs`: owned output envelope and raw framed socket bytes.
- `src/editor_input.rs`: explicit cold model input adapter; Input has no wire derives.
- `src/application_exports.rs`: raw serializedState and download-safe savedState; Macro markdown uses internal/external application transformers while generic sessions keep built-ins.
- `src/query.rs`: portable HTML, Markdown, clipboard and model queries.
- `src/router.rs`: shared RouterCore boundary; outer protocol remains unframed.
- `src/telemetry.rs`: content-free cold native spans forwarded to the host.
- `src/storage.rs`: durable metadata conversions; no storage I/O in Rust.
- `packages/collaboration/src/session/`: JS executor and browser adapters.

## Boundaries

Sync policy, authorization, history and retries remain in document_session/doc_sync_core.
Hosts own clocks, identities, transport, storage and telemetry. Generated artifacts ship
with their glue in one bundle. ABI major mismatch is fatal; no fallback decoding.
Use `createMacro` for application markdown; `create` retains the generic rich-text registry for portable clients and conformance. Keep server composers out of both constructors.
Carry the exact WAL adoption selection across the ABI, including delivered flags and bytes.
Compile release WASM tracing at INFO to match HostSubscriber; preserve emitted cold spans and native tracing.
Preserve keystroke work counters when changing code-generation or post-processing settings.

## Checks

- `cargo test -p document_session_wasm -j4`
- `cargo check -p document_session_wasm --target wasm32-unknown-unknown -j4`
- `cargo clippy -p document_session_wasm --all-targets -j4 -- -D warnings`
- `just -f apps/web/justfile build-document-session-wasm`
- `bun packages/collaboration/scripts/generate-session-schema.ts --check`
- `cargo x deps --check`, `cargo shear`, `just check`, `just pr-privacy`

Set TMPDIR for cargo. Never edit generated files by hand. Keep package registration,
preload rules and size checks aligned with nix/tauri-desktop.nix and apps/web/justfile.
Enforce the provisional D5 1,130,000-byte Brotli cap; WP-59 measures actual startup before the budget is tightened.
