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
