# Lexical conformance WASM

## What it is

Development-only raw-model transaction facades for differential conformance.
Never import them from production crates or bundles.

## Start here

- `src/host.rs`: native-core EditorHandle indexed dispatch over a moved-out Session lease; JS conversions run outside that lease. Runtime transforms/listeners and mutable node hooks use scoped current-hook reborrows; exportJSON and isInline use owned guarded read peers. The complete class facade and remaining pure hooks are unfinished.
- `src/host_commands.rs`: opaque JS application-command envelope over the model extension pipeline, filtering identities before JS; the future shim supplies identity strings and handles parent-editor propagation.
- `src/host_callbacks.rs`: single-threaded JS transform ownership, exact-owner scoped reborrows, callback identity dedup and opaque exception transport. Never recover an ancestor transaction pointer or hold a metadata lock over JS.
- `src/host_packet.rs`: development postcard envelope carrying the existing flat diff and changed base-record/mutation/selection metadata; production uses the session codec.
- `examples/export_host_types.rs`: generate/check the Specta packet declaration with the web formatter.
- `src/debug.rs`: actual export-entry, logical payload-byte and editor-facade lifetime counters; raw WASM must pass through instrument_exports before crossing measurements.
- `build.rs`: build-time syn derivation of fixed scalar/receiver input sizes and string ABI locations; unsupported signatures or unknown exports fail instrumentation.
- `src/compat.rs`: model-derived foreign-hook IDs and format flags and one WASM-instance key counter for shim host allocation/reset; Tier C handles retain their isolated counters.
- `src/lib.rs`: isolated `CoreHandle`, JSON transaction boundary and build identity.
- `examples/instrument_exports/main.rs`: native export counter postprocessor; run after bindgen/wasm-opt and never optimize afterward. Preserve internal model indices; only bindgen throw imports gain outgoing-string wrappers. Keep the reserved counter helper unwrapped so generated raw ABI types stay accurate.
- `src/rich.rs` and `src/rich/input.rs`: rich profile, history, markdown and explicit
  package operations for the external differential harness.
- `src/command.rs`: text/paragraph commands and explicit host-resolved view inputs.
- `src/snapshot.rs`: state, selection, identities and commit records with pre-cache mutations.
- `packages/lexical-conformance/diff/`: loader, reproducible build and JS oracle.

## Boundaries

- Keep `publish = false`, `cdylib` plus `rlib`, and client workspace-hack exclusion.
- Enable the reserved `foreign-nodes` feature only here; WP-54 supplies JS hooks.
- WP-07 uses raw `Editor` transactions. WP-14 replaces v0 JSON commands with
  EditorCore and the session codec. `RichHandle` separately composes the actual
  rich-node, table, clipboard, history and markdown APIs; neither facade
  implements the session codec or Tier B rendering contract.
- Keep S1's UTF-16 edit validation. Interior selection offsets are allowed; edits
  splitting a surrogate pair fail atomically. The differential generator uses
  valid edit boundaries and separately verifies the S1 rejection cases.
- Inputs are development data; never use production credentials or documents.

## Checks

- `TMPDIR=/home/wolf/tmp cargo run -p lexical_conformance_wasm --example export_host_types -j4 -- --check`
- `TMPDIR=/home/wolf/tmp cargo test -p lexical_conformance_wasm -j4`
- `TMPDIR=/home/wolf/tmp cargo test -p lexical_conformance_wasm --example instrument_exports -j4` (Bun executes actual synthetic WASM exports)
- `TMPDIR=/home/wolf/tmp cargo clippy -p lexical_conformance_wasm --all-targets -j4 -- -D warnings`
- `TMPDIR=/home/wolf/tmp cargo check -p lexical_conformance_wasm --target wasm32-unknown-unknown -j4`
- `cargo tree --workspace -i lexical_conformance_wasm -e normal`: only itself.
- `cargo x deps --check`, `just check`.
- `STEPS=10000 bunx vitest run --config packages/lexical-conformance/diff/vitest.config.mts`

## Gotchas

- Build artifacts live in this worktree's `target/` and the ignored package `pkg/`.
- Compare mutations before DOM cache reconciliation and dirty sets from the final commit, matching upstream listeners.
- Keep WP-07 failing tapes under `packages/lexical-conformance/fixtures/fuzz/`.
- Keep the rich differential harness and its failing tapes outside the repository
  under `/home/wolf/tmp/lexical-port/difffuzz`; never copy that harness here.

Rich snapshots retain dangling table selection points with null paths after final row/column deletion.

Count strings as UTF-16 units times two, typed scalar values by their facade width,
and returned object keys/values recursively (JS numbers are f64). Pointer/length,
allocator and generated control metadata carry no payload. Reserved counter-hook
arguments are measurement adjustments, not ordinary payload. Keep return/error
accounting in src/debug.rs helpers when adding exports; raw-input accounting is
derived and runs before receiver validation. Optional strings use pointer zero as
absence even when bindgen leaves a stale length. Each artifact must contain one
unshared memory32 when strings are accounted. Run the postprocessor after optimization.

The native indexed host accepts `{args: [...], this?: encodedHandle}` as one call
envelope. Its JS host owns namespace/editability/theme and discrete scheduling.
The core registry and explicit foreign definitions are accepted; unknown
node types without a foreign definition fail explicitly. The development commit packet is versioned separately
from its unchanged S1 flat diff. Its metadata currently covers base record fields;
foreign payloads and NodeState identity descriptors still need the full host.
Packet and Postcard encoding run through Session::commit_prepared before the
current model transition publishes; errors discard its writes and pending handles.
Previously published preceding transitions remain published. Make delivery failures,
backlogged preceding transitions and chained state/version/tag ownership explicit
before enabling foreign-class commit-time hooks or model follow-up queues here.

Transform registrations share the original JS function identity. Registration and
unregistration inside a callback use its current transaction; type-transform
snapshots remain owned by the model. Exception values stay opaque and are returned
unchanged after normal Rust rollback, including undefined. Do not inspect error
properties or use JS throw intrinsics that bypass Rust destructors. Registration
dirties attached types in the current transaction, or queues that
work for the next explicit begin_update when idle. Scheduling that update, nested
editor.update queues and commit listeners still belong to the future shim.

`register_listener` and `dispatch_command` host opaque JS application commands
through the model's extension-command pipeline. The shim assigns unique identity
strings to JS command objects; diagnostic command names are not identities.
Payloads retain JS identity and never pass through JSON or property inspection.
Only the explicit pending-update, single-editor route is implemented here; the
shim still owns automatic updates and parent-editor command propagation.
Builtin native commands and Tier A indexed fixture dispatch keep their existing
codecs. No production codec carries opaque JS values. Opaque reference transfers
count four logical bytes; listener results cross as a truthiness boolean.

Host packet format2 carries a model-derived changed flag for JS commit-listener
scheduling. A transition can have effects without field diff ops (selection,
composition or reconciliation); never infer no-op status from record/op counts.
Reject the earlier unreleased packet format instead of maintaining a fallback.

finish_noop preserves detached API values while closing a truly unchanged update
without allocating a model commit; false leaves the pending update open.

Count indexed JSON inputs at serde visitor delivery, including map keys and
prefixes consumed before a later error. Keep the wrapped deserializer requests
and error text unchanged; do not count only the final normalized JSON value.

Read foreign_hook_index in override-bit order; it is generated from the model trait, including its explicit upstream aliases. Never hand-maintain another host hook list.

EditorHandle::call_native uses the same validated call envelope, weak callback context, RAII lease and opaque error path as call. It supports mutable and owned-read callback frames and indexed node hooks; remaining pure hooks and import/clone construction scopes are unfinished.

Native-super currently selects the nearest registered native ancestor. Explicit older-prototype targeting (for example a TextNode base method on a TabNode) is still required with the native facade/overlay; do not count this primitive as full native-class hosting acceptance.

Use host_foreign for the currently wired mutable text and structural hooks. Register metadata before editor construction and install JS-owned weak forwarding dispatchers before the first update; clone callback owners out of locks before JS. Unsupported hook bits and native-class overlays reject explicitly until their adapters land. Generate HostNodeMutation from host_protocol with export_host_types; the lexical facade and other foreign hooks remain unfinished.

Structural hosting covers append, splice, remove, setIndent, updateFromJSON and resetOnCopyNodeFrom. Preserve variadic append versus nested splice arrays, and encode model-triggered node arguments with the same callback identity store. Node-returning replace/insertAfter/insertBefore/createParentElementNode hooks validate results through the shared captured identity store; unit hooks ignore arbitrary returns. Pure hooks still require their own adapters.

Mutable insertNewAfter/collapseAtStart callbacks receive the existing selection slot handle; static transform callbacks run through the same exact transaction frame. Optional node returns accept null and reject undefined; collapse results use JS truthiness. Full pure and clone hosting and class construction remain unfinished.

Static importJSON callbacks use HostNodeMutation with a null node and one serialized-node argument. Invoke the factory in the exact mutable callback scope and require a live encoded node result; the model imports children and invokes virtual append after the factory returns. Explicit native-super import construction remains unfinished.

Mutable selectionTransform callbacks receive the previous committed object and current active object. Consume original indexed arguments before encoding fallback selections; native-super bypasses one vtable call. Pipeline focus dispatch follows the live focus after the anchor callback.

Pure exportJSON callbacks run against one independently owned guarded read peer. Reentrant indexed/native/raw reads use that peer; mutations, commands and registrations reject. Preserve original indexed arguments and opaque exceptions through Result/RAII. Inherited selection value writes remain unsupported; originless committed captures require the exact prepared-state lease. This bounded adapter does not complete pure-hook hosting.

Snapshot exportJSON result fields under the caught JS import before serde deserialization: its Object.entries import cannot catch getters. Preserve opaque getter/proxy exceptions and reject undefined results before sentinel encoding. The snapshot retains keys and undefined values instead of JSON.stringify normalization.

Node-returning hook results share the caught tree snapshot with exportJSON before serde. Keep conversion inside the exact callback frame so getters may reenter legitimately, while getter/proxy failures unwind Rust normally. Optional node results still distinguish null from undefined; ignored unit returns never traverse their fields.

Commit-time exportJSON reads the exact canonical next state with leased update metadata, including previous/detached selections and composition. Preparation errors revoke derived read captures before rollback; keep ViewAttached writable-record identities unchanged by using metadata-only contexts.

Decode indexed JS inputs through host_input/safe.rs: catch getters/proxies/iterator steps at their original lazy access points, then retain the existing counted visitor and scalar/byte decoder. Keep opaque accessor errors separate from ordinary serde diagnostics; never eagerly snapshot incoming arrays or change copied-prefix accounting.

EditorHandle::read_state hosts associated-editor reads of retained versions through the same guarded owned peer. Preserve opaque body returns and throws without inspecting properties, and route nested reads through CURRENT rather than a leased Session. This explicit API does not provide editor-less EditorState.read semantics.

isInline is the first hosted pure predicate: use the owned read peer and JS truthiness inside a fallible ForeignReadOperation. Opaque throws defer to the operation boundary; stop later callbacks/writes/caches before returning the original value. This private JS adapter is supported only through scoped host entry points; direct unscoped model predicate reads cannot invoke JS. Text and line-break inline flags remain fixed non-hooks.

canBeEmpty shares the scoped predicate/error adapter. Child removal happens before the parent predicate; a thrown predicate must preserve that earlier detach and stop subsequent empty-parent cleanup, matching the pinned native algorithm.

All no-argument boolean ForeignHooks use the shared predicate adapter. Keep one literal per hook plus native editing cases; a canHaveFormat failure must stop later predicate callbacks and format setters while preserving opaque error identity.

Node-argument canMergeWith/canReplaceWith/canInsertAfter predicates retain original indexed arguments; internal native calls encode their node through the shared owned read peer. Exercise native list append failure and retry in hosting-node-predicates.test.ts.

Native rich-node registrations omit kind and reject foreign behavior; host/native.rs selects their existing Rust implementations. Registrations with kind remain foreign even when their type matches a package node.

Use hosting-scalars.test.ts for owned-peer getIndent/getTextContent reads and excludeFromCopy destinations. Scalar hooks require their declared primitive type; reject objects without getters/coercion, invalid u32 indents, and preserve opaque throws/recovery.

afterCloneFrom receives a generated $clone staging descriptor and original node handle over an owned read peer; it returns initialized own fields before record installation. Never treat staging metadata as a live writable handle. Clone errors use the active fallible failure barrier.
