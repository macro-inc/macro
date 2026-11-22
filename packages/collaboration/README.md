# Collaboration

Shared collaboration runtime used by the web app and non-browser workers.

- `@macro-inc/collaboration/collab/*` contains the Loro manager, sync engine,
  awareness, snapshots, and write-ahead log.
- `@macro-inc/collaboration/sync-service/*` contains the sync-service wire
  protocol and transport. Callers provide the environment-specific URL/token.
- `@macro-inc/collaboration/websocket` contains the typed WebSocket runtime;
  deeper utilities are available through `websocket/*` subpaths. Use
  `withAutoConnect(false)` for session-owned sockets: construction and wake
  signals stay idle until `reconnect()`. `close()` stops retries; a subsequent
  reconnect resolves fresh credentials, discarding URLs from before the close,
  including closes during `UrlResolved` callbacks. Before a native socket exists,
  `readyState` reports CLOSED or CONNECTING, `bufferedAmount` is 0, and
  `extensions` is empty.

Browser authentication, sync HTTP endpoints, and document history UI remain in
`apps/web` because they depend on app state and browser policy.

Document load callers may pass `parentSpan` to the Loro manager and sync engine.
Seed and catch-up phases then retain their caller's trace across asynchronous
work. These components own their child phases and never end the supplied span.
Omitting context preserves independent instrumentation for non-view callers.

`@macro-inc/collaboration/session/*` hosts the portable native session boundary.
`SessionExecutor` serializes admission, applies view effects before I/O, gates
storage on the owner Web Lock, and releases it before broadcasting Closing.
`SessionRouter` shares physical transport while native RouterCore retains policy.
The caller supplies authorization, server URLs, a view applier and a telemetry
parent. Call `start()` once, admit editor calls through `run()`, and await `close()`
before dropping the session. Cold messages come from the generated session ABI.

The storage adapter uses the deployed v1 WAL and snapshot databases. Owner,
sequence and user metadata support crash adoption without wiping legacy rows.
Foreign-user data is retained only for TTL cleanup, never replayed or adopted.
`visible()` awaits Tauri replay recovery before admitting the native signal.

Run `bun run test`, `bun run type-check`, and
`bun scripts/generate-session-schema.ts --check` from this directory. The session
suite initializes the real optimized WASM, so build it first using
`just -f apps/web/justfile build-document-session-wasm` at the repository root.
Real Chromium storage regressions run with
`bunx playwright test --config src/session/browser-test/playwright.config.ts`.
Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for a system Chromium installation.
The suite uses its own headless context and temporary IndexedDB databases.
