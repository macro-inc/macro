# Collaboration

Shared collaboration runtime used by the web app and non-browser workers.

- `@macro-inc/collaboration/collab/*` contains the Loro manager, sync engine,
  awareness, snapshots, and write-ahead log.
- `@macro-inc/collaboration/sync-service/*` contains the sync-service wire
  protocol and transport. Callers provide the environment-specific URL/token.
- `@macro-inc/collaboration/websocket` contains the typed WebSocket runtime;
  deeper utilities are available through `websocket/*` subpaths.

Browser authentication, sync HTTP endpoints, and document history UI remain in
`apps/web` because they depend on app state and browser policy.
