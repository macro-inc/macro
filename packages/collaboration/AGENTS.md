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
Generate session/abi.generated.ts from document_session_wasm/abi/session.bop.

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
