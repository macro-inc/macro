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

Browser health telemetry randomly samples 5% of engines. A sampled engine
reports up to four `collab.snapshot.export` observations, at least one minute
apart, with a coarse elapsed bucket and the outcome of the local Loro export.
Snapshot store and WAL latency are outside that measurement. At owner stop,
`collab.engine.window` reports the elapsed window, writable local Loro batches
per minute (including zero), and bucketed reconnect and running-reset counts.
The window includes reset time and covers engines whose owner calls stop.
WAL delivery can be diagnosed with the existing `wal.delivery_outage` signal,
which recovers after a server ACK and successful local delivery marking.
