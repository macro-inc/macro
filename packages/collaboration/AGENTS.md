# Collaboration

## What it is

Shared collaborative document models, transport and portable session host adapters.

## Start here

- `src/session/`: versioned native session executor, IndexedDB and telemetry adapters.
- `src/session/native-plugins.md`: immutable per-editor plugin ownership, source-generated transformer IDs and mandatory duplicate-logic checks; metadata does not install native policy.
- `src/collab/`: existing Loro manager, recoverable v1 storage and flag-off path.
- `src/websocket/platform/`: browser/Tauri socket implementations and replay recovery.

## Boundaries

SessionExecutor executes effects; Rust owns retry, backoff, WAL and permission policy.
Inspect callback leases only through beforeConsume after successful native calls; finish cleanup and original-cause delivery through afterDrain after the outer FIFO unlocks, preserving an explicit failure holder even for throw undefined.
Transfer native ownership to SessionExecutor only through create; constructor failure invokes the typed onConstructionFailure hook before freeing native resources and releases its lease asynchronously without masking the original cause.
Storage remains compatible with v1 macro-document-wal and macro-document-snapshots.
Hold the owner's Web Lock before storage; release after terminal append and FIFO drain,
then post Closing. Never wipe on error or adopt another user's rows.
On close failure, drain the admitted storage queue and adapter to a stable watermark before fencing further admissions and releasing the lease; finish each cleanup once without replacing the original thrown value.
Round native wake delays up and rearm unchanged deadlines after early browser ticks; a fired host timeout must not strand native snapshot or reconnect work.
Attribute only unowned v1 rows without a user to the current user, identically
during load and conditional adoption; never relabel an owned session row.
Hold the source owner's lease during adoption and the shared snapshot lock while
checking covers and moving WAL rows; reject changed selections without mutation.
Prune only delivered rows covered by the current matching-owner snapshot, under
that lock; TTL cleanup also holds the source lease so reopened owners remain live.
Derive native field metadata from the checksum-pinned class declarations before generating the foreign host schema; keep typed UTF-16/scalar arguments separate from arbitrary opaque JS slots.
Generate session/foreign-host.generated.ts from document_session_wasm/abi/foreign-host.bop; keep compiler output excluded from Biome like abi.generated.ts, mirror that exclusion in tooling/just/check.just, and format AST-derived descriptors in their generator. Preserve public export objects in opaque slots until an explicit serialization request; record references retain their instance owner namespace.
Generate session/abi.generated.ts from document_session_wasm/abi/session.bop.
Keep wasm.generated.d.ts synchronized with the native-only wasm-pack output; the native build recipe copies it so clean checkouts can type-check before compiling the binary. Keep the explicit compatibility-web output separate in wasm-compat.generated.d.ts and export it only as types through ./session/wasm-compat; never add compatibility stubs to native declarations.

## Checks

- `bun run test`
- `bun run type-check`
- `bun ../../node_modules/typescript-native/bin/tsc --noEmit -p tsconfig.session-tests.json`
- `bunx playwright test --config src/session/browser-test/playwright.config.ts`
- `bun scripts/generate-session-schema.ts --check`
- `just check`

Browser storage regressions use headless Playwright, never a person's browser.

Build document_session_wasm before session tests; do not rebuild its artifact while
Vitest is reading it. Use PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH for system Chromium.
The 20 executor goldens come from the native record_effect_traces example; verify
with CHECK_SESSION_TRACES=1 rather than refreshing expected callbacks during tests.

The paired session ABI is major 2: type rows include predicate flags, editor
Initialize is an explicit view marker, and command results use `FLAG_HANDLED`.
`SessionExecutor.run` completion callbacks run after output application.
Use `runSettled` for terminal per-entry observation after the outer drain; preserve opaque errors and accepted FIFO, cancel only never-started entries at the final closed fence, and never treat settlement as durability or a handoff grant.
Time actual native ticks synchronously through the Telemetry facade; correlate returned snapshot-count spans by document and admission sequence, clear packet context before consumption, and distinguish native tick duration from pure export time.
Use `runSync` for synchronous compatibility transactions; it rejects busy,
queued, closing or closed executors before admitting or invoking the call. DOM text
rejection returns authoritative repair/error output, including malformed UTF-16.

`ExecutorOptions.onStatus` observes native connection/save status for application
chrome; keep retry, authorization and persistence decisions in the native core.

The browser Close regression loads the normal source-built EditorSession WASM with
Direct/durable/chatter and real SessionExecutor/storage/lease. Check revocation both
before/after/reentrant Start and cancellation without Start, actual MAX request
reply, disposal, Close idempotency and unchanged DOM. No DOM view is allocated.
Generate session/compatibility.generated.ts from document_session_wasm/abi/compatibility.bop with generate-compatibility-schema.ts; preserve compiler output verbatim and keep typed rendering separate from the flat Diff ABI.

Compatibility generation concatenates the five schemas in explicit source order before invoking the compiler; --check writes only temporary outputs. Generate native plugin identities from the source-generated Rust shortcut catalog before compatibility generation; reject unknown IDs and preserve catalog order. Do not restore filesystem-glob ordering or overwrite live artifacts during freshness checks.

Use CompatInstanceBind for exact-capture JS instance hydration; validate nonzero owner/class/instance identifiers natively without changing graph state or invoking public serialization.

Deliver external native commits through CompatPublications with their actual dirty sets and tags; current-version queries must not discard undelivered publication metadata.

Compact compatibility replies carry mutation epochs and sparse record deltas; retain/release exact capture leases in batches and distinguish native key reservations from captured records.

Batch creation binds the already-constructed JS instance; COW uses clone acknowledgements. Preserve successful-prefix results and partial failure deltas, report an explicit operation or finalization failure, and never admit a failed batch.

Derive exact native prototype IDs and ancestry from the checksum-pinned class AST with generate-compatibility-prototypes.ts before generating the compatibility schema; run both generators with --check. Hosted constructors use global weak JS function tokens independently of editor-local class IDs. Keep scoped callback dispatch, constructor staging and public versus serialized export acknowledgements typed; SourceRead never admits graph writes and NativeSuper targets the exact named prototype.

Apply exact host dirty sets, pinned dirtyType (0/1/2) and composition metadata before invoking callbacks; sparse render records cannot reconstruct intentional dirty-element flags or pending editor state.

Apply active and changed detached selection snapshots before callbacks or rethrowing a failed batch; bind newly issued references to their original JS values before decoding sidecars, preserving partial native effects without read queries.

Run CompatHostReconcile on the real mutable pending state before admission/freeze; acknowledge buffered derived writes and opaque bookkeeping without sending root strings per keystroke. Preserve old captured instance cache values.

The browser history fixture routes real keyboard Enter/undo/redo through keyDown to production EditorSession WASM; assert committed content and durable endpoint identities/offsets after paragraph recreation, with no substitute history or selection model.

Keep complete raw editor JSON, including every durable ID, equal after code-subtree undo/redo; resolving the same caret or matching text alone is insufficient.

Decode SetDecoratorRevision (12) as [key, low32, high32] with full u64 precision; preserve earlier opcodes and reject unsupported stream operations. Enum generation alone does not install decorator lifetime handling.

Preserve EditorPaste tag 4 byte-for-byte at ABI major 2. Send the additive
EditorPasteWithIntent tag 10 only for captured Shift intent on a matched reader;
carry PasteIntentMsg.plainOnly explicitly. Legacy paste/drop maps to the real
model default false; never infer intent from unknown branches or private MIME.
Keep HTML/Lexical precedence and use this flag only for Markdown policy.

Format the ABI samples and executor trace JSON with Biome after recording; freshness checks canonicalize only JSON whitespace and retain exact ordered packet bytes and calls.
