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
- Frontend spans still stop at the fetch for most surfaces. Agent send is the
  exception: `agent.send` starts at the composer click and stays open until the
  first agent message of that turn is folded, so create, the first prompt, the
  session load, and websocket-delivered replies share one trace. Other async
  flows (AI edits applying, channel fan-out) still have no user-action parent.

## Agent sessions

A session's lifetime is reconstructable from these spans. All of them carry
`agent.session.id` — the Macro session UUID, and only ever that. The ACP-local
session name (`cursor-acp-1`) is `agent.acp.session_id`; the two are different
identifier spaces and must not be confused.

| Span | Answers |
| --- | --- |
| `agent.send` | Browser: time from Send on New conversation / a session composer to the first agent message of that turn. `agent.send.surface` is `new_chat` or `session`; `agent.send.outcome` is `responded`, `failed`, `stalled`, or `superseded`. Phase timings (`create_ms`, `prompt_ms`, `user_message_ms`, `agent_message_ms`) and events (`session.created`, `prompt.accepted`, `user_message.visible`, `agent_message.visible`) mark the wait. Never carries prompt text — only `agent.send.prompt_chars` and `agent.send.attachment_count`. HTTP create/control children nest when the send is the active context; `agent.session.load` is a child when the send is still open. |
| `agent.session.load` | Browser: one attempt to open a session. `agent.session.load.outcome` is `loaded`, `released`, `failed`, or `stalled`. |
| `agent.session.acquire` | Browser: a surface took a reference. `agent.session.acquire.created` is true when this opened a new instance. |
| `agent.turn` | Did a Cursor turn run, and how did it end? `agent.turn.stop_reason` / `agent.turn.outcome`, plus `cursor.agent.id` / `cursor.run.id`. |
| `cursor.run.poll` | Is a turn still alive? One per poll, at DEBUG. |
| `agent.session.turn_ended` | The connection's live fold closed the turn on a logged frame; carries `agent.turn.id`, `agent.turn.stop_reason`, and `agent.action.id` when a local prompt opened it. |
| `agent.session.disconnect` | The session's actor wrote a `disconnected` event, and `agent.session.close_reason` says why. |
| `agent.session.mark_disconnected` | The session was marked dead by its opener because the runtime never came up. |
| `agent.pipe.reap` | A Cursor pipe was closed for idleness, with `agent.pipe.idle_ms`. |
| `agent.session.realtime.publish` | A frame reached watchers; `agent.log.event` names the status event when it is one. |
| `agent.session.rename` | Auto-naming ran; `agent.rename.outcome` says whether it named, skipped, or failed. |

Two things worth knowing when reading these:

- **An unset `agent.turn.outcome` is a signal, not missing data.** `#[instrument(err)]`
  records an error only on an `Err` return, so a turn whose future is *dropped* — a pipe torn
  down under it — closes its span with no error and looks identical to a clean finish. The
  outcome field is recorded explicitly on the way out; if it is absent, the turn did not
  return.
- **The idle-check DEBUG line fires every tick, not just the reaping one.** `agent.pipe.reaped`,
  `agent.pipe.active_turn` and `agent.pipe.idle_ms` on the ticks that did *nothing* are what
  show a deadline sitting long expired while a live turn held the pipe open.
