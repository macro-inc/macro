# Document sync through DSS

When PostHog `sync-via-gateway` is enabled, the browser opens a dedicated
WebSocket at DSS `/sync/ws` (public gateway prefix: `/dss/sync/ws`). The historical
flag key remains unchanged. Notifications retain their separate connection-gateway
socket. DSS hosts the reusable `crates/sync_router` library; no new service,
Pulumi stack, Redis relay, or distributed subscription registry is required.

```text
Browser
  +-- notification socket --> connection_gateway
  |
  +-- dedicated sync socket --> DSS /sync/ws
       ToRouter / FromRouter    socket-owned SyncSession
       (docId, payload)          +-- document A --> sync-service DO A
                                +-- document B --> sync-service DO B
```

The endpoint authenticates the account using the standard Macro cookie/API-token
extractor. Each subscription carries a separate document-scoped token. The
sync-service Durable Object validates that token and continues to own document
state, permission enforcement, and durable acknowledgements. Only a successful
upstream handshake produces `RouterSubscribed`; duplicate subscribes cannot
acknowledge a pending or rejected handshake.

`SyncRouterTransport` multiplexes document virtual sockets using the generated
Bebop `ToRouter` and `FromRouter` envelopes. The router reads the outer document
id and forwards the inner bytes unchanged. Existing 900,000-byte chunking and
per-document reassembly remain in place under the envelope. Text `ping`/`pong`
heartbeats apply to the dedicated sync socket.

Each client socket owns its routes and downstream tasks. Any DSS replica can
accept a connection; reconnecting to another replica creates new routes and
re-subscribes with refreshed document tokens. Replicas share no routing state.
The client sync runtime re-synchronizes unacknowledged edits from its document
state. A connection loss never counts as a durable acknowledgement. Pending ack waits
end immediately on disconnect, releasing the WAL flush before reconnect replay.
Trace context travels from the browser in the upgrade query and is propagated
through the DSS session into downstream connections.

Both WebSocket receive directions have explicit size limits around one MiB.
The client and router queues hold at most eight messages each. All downstream
queues and in-flight writes share an eight MiB budget per session, independently
of the 64-document cap. Overflow closes the route or socket so clients resync;
no chunk is silently discarded from a continuing stream. Unsubscribe cancels
pending dials and writes. DSS shutdown cancels and drains upgraded sync sessions.

Deploy DSS before enabling the flag. Off or unknown values retain direct
per-document sync-service sockets. Local stacks can set
`VITE_SYNC_VIA_GATEWAY=true` or `false`. A source selects its transport for its
lifetime; recreate document sessions after a flag update. Cached PostHog values
can survive reload, so the flag is not an immediate kill switch for open sessions.

The router core depends on `EdgeSink` and `DownstreamFactory` ports. A future
standalone host or gRPC adapter can replace those adapters without changing the
browser envelope or document sync protocol.
