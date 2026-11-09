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
- `src/macro_editor.rs`: delegate the MarkdownSync preset to document_session::application_editor_config for `EditorSession.createMacro`; group plugin registration lives in macro_document_model/src/surface.rs.
- Serialize application PluginEvent payloads through surface.rs group encoders into the existing editor-effect envelope; never perform host I/O in the model.
- `src/output.rs`: owned output envelope and raw framed socket bytes.
- `src/editor_input.rs`: explicit cold model input adapter; Input has no wire derives.
- `src/compatibility.rs` and `compatibility/`: optional production same-core adapter, indexed exact captures, retained publications and normal session admission; schema generation stays in the separate compatibility generator. Reply only with receiver/result/dirty records, reuse an unchanged exact capture, and distinguish capture identity from the JS state/key instance map. Never silently run native behavior for advertised JS hooks before their callback host is installed.
- `src/application_exports.rs`: raw serializedState and download-safe savedState; Macro markdown uses internal/external application transformers while generic sessions keep built-ins.
- `src/query.rs`: portable HTML, Markdown, clipboard and model queries.
- `src/paste_init.rs`: additive prepareMacroPaste export; the shared engine gate calls it during idle preparation after paint, before admitting editor input. Reserve 16 MiB through the allocator in that hook so idle initialization owns growth and dlmalloc can reuse the pages.
- `src/router.rs`: shared RouterCore boundary; outer protocol remains unframed.
- `src/telemetry.rs`: content-free cold native spans forwarded to the host.
- `src/storage.rs`: durable metadata conversions; no storage I/O in Rust.
- `packages/collaboration/src/session/`: JS executor and browser adapters.

## Boundaries

Route raw live-state string and query-kind-7 exports through the model streaming writer in `src/bulk.rs`; keep application saved-state cleanup separate.

Sync policy, authorization, history and retries remain in document_session/doc_sync_core.
Hosts own clocks, identities, transport, storage and telemetry. Generated artifacts ship
with their glue in one bundle. ABI major mismatch is fatal; no fallback decoding.
Use `createMacro` for application markdown; `create` retains the generic rich-text registry for portable clients and conformance. Keep server composers out of both constructors.
Carry the exact WAL adoption selection across the ABI, including delivered flags and bytes.
The document-session-wasm profile optimizes the measured group of six paste caller crates at level 3; keep dependency tuning separate and compare fresh paired browser samples before changing the group.
Compile release WASM tracing at INFO to match HostSubscriber; preserve emitted cold spans and native tracing.
Preserve keystroke work counters when changing code-generation or post-processing settings.

Reserve a fresh pending publication version at compatBegin, publish that version only after admission, and burn it on discard/no-op. Observe Start/Seed/remote/undo through compatCurrentVersion; compatSnapshot(version) always reads that exact retained publication. Validate full issued references for receivers and typed arguments; raw core-field reads use their owned captures rather than the latest graph. Pure commit observers may collect receipts, never install parallel editing behavior.

## Checks

- `cargo test -p document_session_wasm -j2`
- `cargo check -p document_session_wasm --target wasm32-unknown-unknown -j2`
- `cargo clippy -p document_session_wasm --all-targets -j2 -- -D warnings`
- `just -f apps/web/justfile build-document-session-wasm`
- `bun packages/collaboration/scripts/generate-session-schema.ts --check`
- `cargo x deps --check`, `cargo shear`, `just check`, `just pr-privacy`

Set TMPDIR for cargo. Never edit generated files by hand. Keep package registration,
preload rules and size checks aligned with nix/tauri-desktop.nix and apps/web/justfile.
Treat 1.6 MB Brotli as an advisory ceiling; retain nonblocking preload and strict startup/document-open latency gates, plus composer regression checks.

Generate compatibility_generated.rs and collaboration/session/compatibility.generated.ts from abi/compatibility.bop plus the shared foreign-host schemas using generate-compatibility-schema.ts. Compatibility requests use exact captured record references and separate typed render metadata; preserve the session and flat Diff ABIs. These envelopes do not themselves provide a working production initializer.

Use editor/update-bound native key reservations for compact buffered writes; never invent keys or reuse discarded reservations. Batch capture retains before releases, preserve leased frozen records, and invalidate root text caches in incremental deltas instead of retransmitting document text.

Retain single-use ForeignReservedKey capabilities behind compatBeginCompact/compatReserveKeys tickets; blocks are bounded to 65,536 keys and belong to one editor/update. Retire unused tickets on commit/discard/no-op without rolling the allocator back. These additive reservation exports do not provide batch construction by themselves.
Use document_session export helpers for upstream and application HTML/Markdown so native and WASM share the same registry and transformer policy.

Keep selection value identity separate from its allocation graph: exact leased references survive graph retirement/discard, while each call chooses its read graph. Rehydrate current raw detached values before querying a reused pending slot. Reconcile the actual active identity before publication so replaced values remain mutable; only the final published selection freezes. Historical getPreviousSelection reads the current editor publication. Retire dropped legacy-finalizer values/pins on rejection while preserving invalid-envelope staging; a failed compact batch remains a per-request failure, not a poisoned update.

Validate every compact-begin class-mask owner/class/duplicate/bit patch before allocating keys or opening a scope; apply only the validated list to shared atomic cells. Reject advertised nonzero hooks without an installed host; mask transport alone does not implement hosted callbacks.

Generate compatibility-prototypes.bop and its source metadata with generate-compatibility-prototypes.ts before compatibility schema generation. Hosted callback requests carry exact scope authority and sparse deltas; creation binds the already-run constructor before native continuation, and explicit native-super dispatch never substitutes a nearer ancestor. Constructor tokens identify actual JS functions across editor-local IDs; these envelopes do not implement callback execution by themselves.

Disable class static transforms in the compatibility factory so unchanged JS registrations own them once; keep createMacro defaults intact and retain core text normalization.

Install one module-stable compatibility host dispatcher and use exact callback-only scope IDs through compatibilityCallbackCall; release all native store/dispatcher borrows before JS callouts and validate acknowledgement scope/kind/identity before applying patches. The transport boundary does not install class hooks or make the initializer usable by itself.

Resolve node capture/operand authority into an owned NativeCall before model execution when using callback frames; do not retain a mutable Host borrow across virtual model calls. Execute selection graph plans outside metadata borrows and finalize owned value/cache/identity facts afterward.

Use the scoped metadata frame for native node calls so authorization borrows end before virtual execution; keep selection graph execution outside the frame borrow through its owned executor. Scoped metadata alone does not supply the hosted factory or callback graph adapter.

Return updated typed selection bodies beside ordinary scalar/node results; mutable current direction queries may acknowledge memo changes without dirtying the graph, while historical and frozen raw captures retain their metadata.

Route SetNativeField through typed raw-base assignments after capture/update/writable checks; do not redispatch public setters or clear selection caches a second time. Preserve raw element-format numbers independently of their exported alignment names.

Disable native reconciler cache derivation in compatibility factories so the JS
reconciler owns root text and element text-format/style caches, including virtual
setter calls. Keep createMacro cache behavior unchanged; prepublication derived
acknowledgements still require their own validated reconciliation stage.

Capture compatibility snapshots and publication metadata without materializing
root text; raw cache absence must survive hydration and transport refresh.

Keep CompatAuditSnapshot cold and read-only: count retained captures and actual live nodes without allocation or collection, reject pending updates, and measure it outside update/read/key windows.

Emit sparse compatibility commit batches from actual dirty/mutation receipts;
include every destroyed descendant from the previous subtree, filter against
final membership, and reserve full batches for explicit snapshots or actual
full reconciliation. Omit root text strings from hot replies and commit deltas.

Advance the cold audit retirement epoch only after completed native capture-index
pruning, including valid repeated historical releases with no removable captures;
never advance it for observation, a GC request, or discard without a pending
update. Pair the acknowledgement with the current version; it does not prove JS GC.

Reject cold audit snapshots until normal publication acknowledgement catches up
to the actual session state; never refresh receipts inside the getter or pair a
stale compatibility version with live-node counts from a newer graph.

Carry encoded host-thrown values through Error::Extension as HostThrown with the
original host slot and opaque value; recover through ForeignReadFailed wrappers
without stringification or replacement. Preserve explicit undefined/null, and
reject missing/zero-slot envelopes before creating the carried cause.

Use only actually issued retired versions for explicit native retirement fences;
reject never-issued, current and pending versions before any retirement effects.

The hosted lifecycle slice supports explicit core/heading storage metadata and
exact record hydration with semantic clone stages; constructor tokens and original
instance namespaces never come from type names. Reject unsupported virtual hooks,
class storage codecs and clone graph callbacks explicitly. These limited exports
do not make the full production initializer usable. Keep native keys global across
hosted editors and legacy diagnostic key allocation unchanged.

Retain weak native-owner aliases across private session rebuilds within the same
logical JS namespace; keep cross-editor transfer closed until its explicit
constructor-token policy is installed. Claim each JS instance ID once per runtime
(including discarded clone attempts), allow idempotent bind only on its original
exact record, and hydrate only retained committed captures while no update is pending until
the creation adapter preserves update writability (including historical pending
captures that carry update ID zero).

Run the raw lifecycle smoke with Bun and explicit source-matched wasm-bindgen
JS/WASM paths: `bun crates/client/document_session_wasm/tests/hosted-lifecycle.mjs
<module.js> <module_bg.wasm>`. It uses pinned upstream root clone methods and
checks only the lifecycle boundary, not the full facade or browser parity.

Default/native builds enable only bebop-owned-all and exclude compatibility plus
lexical_model/foreign-nodes. Enable compat-web explicitly for the separate compat
web artifact; it includes owned wire types and the compatibility runtime. Keep
native and compat glue, wasm and generated declarations together in distinct
outputs; a native declaration must not grow optional compatibility stubs.

The first compact batch consumer synchronously flushes a single pending update,
validates Begin/Continue authority, and acknowledges successful prefix plus caught
failure effects before allowing a retry. Hosted compact admission invokes a
validated Mutable Reconcile stage before ordinary session admission; unsupported
host callbacks and opaque reconciliation patches still reject explicitly. Apply exact capture leases
atomically before operations, retain input operands through execution and hold
constructed operands until their update retires. Reserved
construction supports exact core/heading instance seeds, with real key tickets
and constructor-global instance IDs; generic classes/creation callbacks remain
closed until their handlers land. Keep noop false while the pending update remains open. Normalize under
a scoped metadata frame so clone callbacks can inspect owned source facts without
a mutable Host borrow. Derive removed keys from actual record retirements, including
collected descendants, rather than treating missing dirty keys as a complete log.

Validate constructor seed base/projection/class before consuming its key ticket.
Execute the owned construction plan outside Host borrows, preserve the original
numeric JS instance, and resolve later reserved operands through the actual result
capture. Constructor failure burns a consumed ticket/claimed instance identity;
never rerun it or allocate a substitute key. Clear constructed operand bindings
when the update retires. Preserve opaque JS fields in the JS instance store rather
than serializing them into native payloads.

Use with_pending_frame and dispatch_current for synchronous child callback
execution. Keep metadata guards inside prepare/encode closures, release them
before native model calls, and reject missing/overlapping frame access. Direct
child dispatch must validate captured node receivers before selection effects.

Acknowledge generated selectionBindings in batch and host envelopes before body
decoding when a real resolver supplies them. Until intent resolution exists,
reject selection-intent arguments before any constructor/mutation; empty binding
sidecars alone do not implement New client values or authorize fabricated refs.

Drain finalizer capture metadata through compatCaptureLeases without opening an
update or publishing a graph. Explicit capture leases survive allocation-version
retirement; emitted compact replies survive discard until decoder retention or an
explicit graph retirement fence. Validate the full lease plan and epoch before
opening a compact Begin, retain before release, and prune only touched capture
indexes. Legacy diagnostic calls retain their original unleased discard policy
until a compact batch or valid cold lease drain opts into emission retention.

Share compact and scoped callback execution through batch_execution under an
existing pending metadata frame. Keep Host borrows inside prepare/encode only;
never hold them while a native plan or normalizer invokes JS. Scoped callbacks
must not normalize/admit recursively; the outer flush owns normalization. Advance
the mutation epoch before execution and return its actual latest value so child
operations are not overwritten by the parent receipt.

Resolve compact no-op receipts to the retained committed publication (including
version zero), not the burned pending version. Normalize admission mutations
after executing them, but never replay an already-flushed pipeline at admission.
Recover and reopen only unadopted policy refusals; consumed failures are fatal,
and a real publication plus an error must retain its published receipt rather
than fabricate rollback. Apply every prefix/detached selection sidecar before
surfacing a callback failure. Reject recursive Begin/finalize in callback scopes.

Ship final typed retired-record fields alongside removed keys so retained JS
instances receive their final scalar/link state before map deletion. Keep retired
capture authority indexed separately, raw reads exact and normal graph lookup
unable to resurrect collected nodes. Union pending retirements (including nodes
created and collected within one update) with committed subtree removals, filter
final live membership, and bypass public exportJSON/getters during this path.
Drain actual external compatibility commits through compatTakePublications until empty before currentVersion or Begin; preserve queued receipts and reject pending drains. Treat flags=0 as drain-only metadata, never a replacement for the causal session output. Close the one-time cold bootstrap only at the exact currentVersion/full-snapshot fence; reject later owner rebuilds without silently replacing state.
