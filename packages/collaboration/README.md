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

The sync engine checkpoints snapshots every five seconds only when the document
identity, Loro operation-log frontier, current-state frontier, or pending local
operations differ from the last successfully saved checkpoint. Idle ticks still
flush and prune delivered WAL rows. Saves are serialized; failures retry on the
next tick, and edits during a save remain eligible for the next checkpoint.
