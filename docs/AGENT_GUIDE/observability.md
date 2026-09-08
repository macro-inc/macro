# Correlating UI Actions to Traces and Logs (Grafana MCP)

The local stack ships an LGTM sidecar; the Grafana MCP server exposes it. Datasource UIDs:
`tempo`, `loki`, `prometheus`, `pyroscope` (confirm with `list_datasources`).

## The trace for the thing you just did (deterministic)

Every frontend request to the backend proxy carries a W3C `traceparent` header. That trace ID
is the join key:

1. Perform the UI action.
2. `list_network_requests` (resourceTypes xhr/fetch) → find the mutating request, e.g.
   `POST /dss/documents/create_task`.
3. `get_network_request` with its reqid → read
   `traceparent: 00-<trace_id>-<span_id>-01` from the request headers.
4. `tempo_get-trace` with `trace_id` and `datasourceUid: "tempo"`.

Expected shape today: a `web-app` CLIENT span (`http POST /dss/...`, attributes include
`usr.id`) parenting one Rust SERVER span (`http.request` from `macro_tower_layers`, with
`http.route`, `url.path`, `http.response.status_code`, `latency_ms`, `request.id`).

Secondary key: the HTTP response header `x-request-id` equals the server span's `request.id`
attribute.

## Finding traces without a reqid (TraceQL)

- Discover services: `tempo_get-attribute-values` on `resource.service.name`.
- Discover attribute names: `tempo_get-attribute-names`.
- Search: `tempo_traceql-search` with e.g.
  `{ span.url.path = "/documents/create_task" && resource.service.name = "document_storage_service" }`
  (add `start`/`end` RFC3339 to narrow; default window is 1h). Note CORS preflights create
  separate tiny traces for the same path — prefer the trace whose root is `web-app`.

URL prefix → service mapping: `/dss/*` → document_storage_service,
`/unfurl/*` → unfurl_service, `/cognition/*` → document_cognition_service,
`/auth/*` → authentication_service, `/email/*` → email_service. Frontend OTel
exports to `/i/otlp/v1/{traces,logs}`.

The local Caddy proxy strips these prefixes before forwarding, so `span.url.path` is
unprefixed locally. The deployed gateway ALB does **not** strip `/dss`, `/unfurl`, or
`/auth` — those services serve the same routes at both `/` and the prefix — so in
dev and prod `span.url.path` includes the prefix. Query both forms when a search
comes back empty.

## Logs (Loki)

Only two stream labels exist: `service_name`, `deployment_environment`. Example:
`query_loki_logs` with `{service_name="document_storage_service"}`. Events emitted inside a
span carry `trace_id`/`span_id` as structured metadata (not labels), so the join works both
ways: filter logs by a known trace with
`{service_name="X"} | trace_id="<id>"`, or read `trace_id` off an error line and
`tempo_get-trace` it. Events emitted outside any span (startup, background loops) have no
trace context — timestamps + service are the only join for those.

## Known gaps (verified 2026-08-31, local)

- `agent_harness_service` emits logs but **no traces at all**; AI-chat requests
  (`POST /cognition/stream/chat/message`) produce a trace containing only the browser client
  span — the cognition HTTP server layer emits no server span, so the entire agent loop
  (tools, model calls) is invisible in Tempo.
- `document_cognition_service` emits orphaned single-span traces (`add_subtoolset`) and giant
  "root span not yet received" traces made of repeated 10-second spans (a polling loop traced
  per-iteration under a never-ending root).
- Server traces are shallow: `http.request` spans have no child spans (no DB, S3, or
  inter-service client spans), so a trace tells you the route and latency but not why.
- Log lines from events outside spans (startup, pollers) have no trace_id; in-span events do
  (structured metadata), so prefer erroring *handlers* as log entry points.
- Frontend spans stop at the fetch: no spans for user interactions or the websocket-delivered
  results, so async flows (AI edits applying, message fan-out) have no trace at all.
