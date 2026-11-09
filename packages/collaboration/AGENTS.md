# Collaboration

## What it is

Shared collaborative document models, transport and portable session host adapters.

## Start here

- `src/session/`: versioned native session executor, IndexedDB and telemetry adapters.
- `src/collab/`: existing Loro manager, recoverable v1 storage and flag-off path.
- `src/websocket/platform/`: browser/Tauri socket implementations and replay recovery.

## Boundaries

SessionExecutor executes effects; Rust owns retry, backoff, WAL and permission policy.
Storage remains compatible with v1 macro-document-wal and macro-document-snapshots.
Hold the owner's Web Lock before storage; release after terminal append and FIFO drain,
then post Closing. Never wipe on error or adopt another user's rows.
Round native wake delays up and rearm unchanged deadlines after early browser ticks; a fired host timeout must not strand native snapshot or reconnect work.
Attribute only unowned v1 rows without a user to the current user, identically
during load and conditional adoption; never relabel an owned session row.
Hold the source owner's lease during adoption and the shared snapshot lock while
checking covers and moving WAL rows; reject changed selections without mutation.
Prune only delivered rows covered by the current matching-owner snapshot, under
that lock; TTL cleanup also holds the source lease so reopened owners remain live.
Derive native field metadata from the checksum-pinned class declarations before generating the foreign host schema; keep typed UTF-16/scalar arguments separate from arbitrary opaque JS slots.
Generate session/foreign-host.generated.ts from document_session_wasm/abi/foreign-host.bop; keep compiler output excluded from Biome like abi.generated.ts, and format AST-derived descriptors in their generator. Preserve public export objects in opaque slots until an explicit serialization request; record references retain their instance owner namespace.
Generate session/abi.generated.ts from document_session_wasm/abi/session.bop.
Keep wasm.generated.d.ts synchronized with wasm-pack; the build recipe copies it
so clean checkouts can type-check before compiling the binary.

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
`SessionExecutor.run` completion callbacks run after output application. DOM text
rejection returns authoritative repair/error output, including malformed UTF-16.

`ExecutorOptions.onStatus` observes native connection/save status for application
chrome; keep retry, authorization and persistence decisions in the native core.
