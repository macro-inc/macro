# Correlating UI Actions to Traces and Logs (Grafana MCP)

The local stack ships an LGTM sidecar; the Grafana MCP server exposes it. Datasource UIDs:
`tempo`, `loki`, `prometheus`, `pyroscope` (confirm with `list_datasources`).

## The trace for the thing you just did (deterministic)

When browser telemetry is enabled, traced frontend requests to the backend proxy
carry a W3C `traceparent` header. That trace ID is the join key:

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
`/unfurl/*` → unfurl_service, `/cognition/*`, `/scheduled-action/*`, `/preview/*`, and `/mcp/*` → agent_harness_service,
`/auth/*` → authentication_service, `/email/*` → email_service. Frontend OTel
exports to `/i/otlp/v1/{traces,logs}`.

The local Caddy proxy preserves cognition, scheduling, preview, and MCP prefixes.
It strips most other service prefixes, so their `span.url.path` is unprefixed locally. The deployed gateway ALB does **not** strip `/dss`, `/unfurl`, or
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

- `agent_harness_service` emits logs but **no traces at all**; requests to its cognition
  routes (such as `POST /cognition/structured-completion`) produce a trace containing only the
  browser client span — the cognition HTTP server layer emits no server span, so the work
  behind them (tools, model calls) is invisible in Tempo.
- The cognition surface in `agent_harness_service` emits orphaned single-span traces (`add_subtoolset`) and giant
  "root span not yet received" traces made of repeated 10-second spans (a polling loop traced
  per-iteration under a never-ending root).
- Server traces are shallow: `http.request` spans have no child spans (no DB, S3, or
  inter-service client spans), so a trace tells you the route and latency but not why.
- Log lines from events outside spans (startup, pollers) have no trace_id; in-span events do
  (structured metadata), so prefer erroring *handlers* as log entry points.
- Most frontend spans stop at the fetch: websocket-delivered results such as AI edits
  applying and message fan-out remain untraced. Call joining now has a user-action
  trace; see below.
- `email_service` wraps its routes in tower-http's default `TraceLayer`, not
  `macro_tower_layers`. Its request span is DEBUG level, below the INFO trace
  filter. The span also ignores `traceparent`, so browser traces of email_service
  requests end at the `http` client span. The gap is read from the code and not
  yet confirmed in Tempo.

## Account WebSocket sessions

Search for `{ name="auth.session_websockets.activate" }` after signing in.
`user.id_hash` is SHA-256 of the Macro user ID; this trace suppresses automatic
raw user-ID enrichment because Macro IDs can contain email addresses. No socket
URLs, tokens, close reasons, or raw credential errors are recorded.

Gateway and storage child spans share that activation trace. `ws.service`
identifies the socket. `auth.session_socket.resolve_url` measures authorization
and URL resolution; `auth.session_socket.handshake` measures the upgrade. Their
`auth.session_socket.connect` parent ends on connection, failure, or cancellation.
`auth.session_socket.retry` records retry count and backoff milliseconds;
`auth.session_socket.close` distinguishes disconnects from session teardown.
Activation ends promptly rather than staying open for the whole login; later
retries and closure remain children of its trace.

Auth-refresh HTTP requests started during URL resolution inherit its trace
context. Browser WebSocket upgrades cannot send custom trace headers, and these
account backends do not currently consume trace-context query parameters, so
upgrade server spans are not yet joined to this browser trace. Verify browser
phases separately rather than assuming end-to-end upgrade correlation.

## Call joining

Click **Start call** on `/app/meet/new` or **Join call** on a shared meeting's
setup screen. Search Tempo for `{ name="meeting.join" }`. One browser trace
covers an accepted button press through connection or failure:

| Span | What it measures |
| --- | --- |
| `meeting.join.previous_session` | Waiting for previous session cleanup. |
| `meeting.join.create` | Preparing the meeting link for a new call; absent for shared-link joins. |
| `meeting.join.credentials` | Requesting join credentials, including backend room allocation. |
| `meeting.join.connect` | Connecting the browser call session after receiving credentials. |

The root records `meeting.join.kind` (`create` or `join`), guest status,
microphone/camera preferences, `call.id` once credentials arrive, and
`meeting.join.outcome` (`connected`, `failed`, `cancelled`, or `already_in_call`).
Its duration excludes setup-page loading and completion of background media
setup. The `call.media.setup` child continues after the join root ends; inspect
its per-device children for capture and publishing failures. Earlier waiting-room
captures correlate through `meeting.setup.id`, and the join records final device
access states. See [browser call diagnostics](calls.md#browser-call-diagnostics)
for fields, failure interpretation, and verification.
Never add share tokens or RTC credentials to trace attributes or errors.

The HTTP requests can have separate trace IDs across asynchronous mutation
boundaries. Capture each request's `traceparent` as described above and inspect
the backend trace as well. For the join request, compare `create_room`,
`prepare_meeting_call`, and `join_invitation`; `start_meeting_media` runs in the
background and must not be added to the time spent waiting for credentials. Channel
calls similarly launch `start_channel_call` for recording, transcription, and
recipient notifications; these run concurrently outside the token response path.
A slow recorder or push provider should not hold the creator on Connecting.

## Email From switch

The composer's From switch moves a saved draft to an inbox on another account.
Search Tempo for `{ name="email.draft_transfer" }`. One browser trace covers the
move:

| Span | What it measures |
| --- | --- |
| `email.draft_transfer.save` | The save before the move. A retry of an unanswered move skips it. |
| `email.draft_transfer.request` | The transfer until the server commits or refuses it. `email.draft_transfer.committed_by` is `response` or `recovery`. |
| `email.draft_transfer.recover` | The recovery request after the transfer request failed or lost its response. |
| `email.draft_transfer.refresh` | The detached refresh of both threads' caches. It can end after the root. |

The root's attributes use the `email.draft_transfer.` prefix. They are
`draft_id`, `operation_id`, `source_inbox_id`, `destination_inbox_id`,
`destination_provider`, `attachment_count`, `retry`, and `outcome`. The outcome
is `moved`, `aborted`, `failed`, `rejected`, or `skipped`. Aborted and failed
moves are errors. A rejection is not an error. It adds `rejection`, which is
`pending_other_inbox`, `attachment_limit`, or `unconfirmed_draft`. A retry shares
the first attempt's `operation_id`, so search by it to join attempts across
traces. Errors carry fixed messages. Never add addresses, subjects, bodies, or
file names. The `http POST` spans carry `traceparent`, but email_service does not
join the trace yet (see known gaps).

## Email Focus live updates

Search Tempo for `{ name="email_focus.classify" && span.thread_id="<id>" }`. One
trace covers an email event from its Kafka publish to the browser's read:

| Span | What it measures |
| --- | --- |
| `kafka.process` | One `macro.email` event in the `email-focus` group, until its classification ends. |
| `email_focus.queue` | The wait for the thread's turn: mail for a thread being classified runs after that call. `event_age_ms` is the time from publish to receipt, which includes any time the consumer stopped reading because every slot was busy. |
| `email_focus.classify` | One classification: `classify_thread`, with its mail reads, `jev.evaluate`, and `save`. `outcome` is `classified`, `redecided`, `up_to_date`, `missing`, `not_signal`, `not_enabled`, `unavailable`, `rejected`, or `failed`. `event_age_ms` is the time from publish to the end. |
| `email_focus.notify` | One push to an inbox's readers, under the newest classification it covers. `coalesced` counts the classifications it covers, and 0 marks the repeat for the replica. `delivered` counts the websockets that got it. |
| `connection_gateway.websocket_send` | The frame leaving the gateway. |
| `email.focus.refresh` | The browser's read after a push, joined through the push's `traceparent`. A read after a reconnect starts its own trace. `email.focus.threads` is the list's size. |

## Agent sessions

A session's lifetime is reconstructable from these spans. All of them carry
`agent.session.id` — the Macro session UUID, and only ever that. The ACP-local
session name (`cursor-acp-1`) is `agent.acp.session_id`; the two are different
identifier spaces and must not be confused.

| Span | Answers |
| --- | --- |
| `agent.turn` | Did a Cursor turn run, and how did it end? `agent.turn.stop_reason` / `agent.turn.outcome`, plus `cursor.agent.id` / `cursor.run.id`. `agent.turn.gate_wait_ms` is time spent waiting behind a mirror of a run started from cursor.com before the turn could begin. |
| `agent.session.background` | The per-session task that mirrors cursor.com and reaps idle pipes. Every `cursor.run.ingest` a mirror runs sits under it, which is what makes a mirrored run searchable by Macro session id. |
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
  show a deadline sitting long expired while a live turn held the pipe open. Production does
  not ship DEBUG, so the same condition is also said at WARN — `cursor pipe idle past its
  deadline but held open by a turn or an admitted command`, with the in-flight turn's id and
  age — once the pipe has been held open for half an hour, and once per half hour after.

Log lines to search for when a session's queue is not draining, in the order a stuck
prompt passes them:

| Line | Where | Means |
| --- | --- | --- |
| `forwarding an agent session command` | the replica that took the request | The command left for the managing replica; this replica reports `Sent` regardless of what happens next. |
| `executed a forwarded command` / `forwarded command failed` | the managing replica | The command arrived, and what it returned (`Completed` or `Queued`). Absent means the Redis hop lost it. |
| `action queued behind the turn in flight` | the managing replica | Why the prompt is waiting: the in-flight turn, its action id, and `in_flight_age_secs`. |
| `recovering a run started elsewhere` | the Cursor service | A mirror or a pre-prompt backfill is about to follow a cursor.com run; `cursor.run.still_running=true` means it will hold the turn gate until that run ends. `finished recovering …` closes it with `elapsed_ms`. |
| `waiting for the turn gate behind a mirror …` / `acquired the turn gate` / `stopped while waiting …` / `gave up waiting for the turn gate` | the Cursor service, inside `agent.turn` | The prompt is parked behind that mirror, and how the wait ended. |

## Tauri desktop memory recordings

The web frontend keeps `service.name=web-app`; distinguish native windows with
`resource.app.runtime = "tauri"` (`"browser"` for regular tabs). Tauri events carry
`service.instance.id`, a UUID for the native launch. Explicit macOS recordings add
`macro.recording.id`; this remains stable across webview reloads and is shared by
frontend traces, logs, and `app.memory.sample` spans.

Launch instructions and memory field definitions are in the
[Tauri recording guide](../../apps/web/tauri/src-tauri/README.md#desktop-memory-recording-macos).
Quit any existing instance before launching with the recording arguments.
The native title bar shows a shortened recording ID; find the full ID in the
`Desktop memory recording enabled` startup log or any recording span's resources.

TraceQL examples:

```traceql
{ resource.app.runtime = "tauri" && resource.macro.recording.id = "<recording UUID>" }
{ resource.macro.recording.id = "<recording UUID>" && name = "app.memory.sample" }
```

Each action span has its latest memory sample at start and end (`.end` suffix).
Use `macro.memory.web_content.footprint_bytes` for the frontend renderer and
`macro.memory.frontend.footprint_bytes` for the measured WebKit helpers together.
Check `macro.memory.frontend.status` and sample age before interpreting readings.
Missing/unavailable values are not zero. The Rust host is reported separately as
`macro.memory.native.*`. Sample spans retain native timestamps after a webview
pause; sessionStorage avoids duplicate draining on ordinary reloads.

Backend spans join through the existing `traceparent` trace ID; recording resource
attributes belong to the frontend, and are not automatically copied onto backend
services. Correlate complete traces by finding their frontend span. Always-on
client sampling does not override downstream sampling or prevent transport loss.

## Web performance traces

How to add these flows is in the `instrumentation` skill; this section is how to
find and read them.

### Finding them

Boot, navigation, view loading and in-view interactions are `perf`-class traces.
Search `{ resource.service.name = "web-app" && span.macro.sampling.class = "perf" }`,
or by root name: `app.boot`, `navigation`, `view.<route id>` (with `route.id`),
`list.open`, `channel.tab`, `form.tab`, `email.tab`, `quick_access.open`,
`quick_access.input`, `calendar.event.open`, `message.send`, `email.send`,
`input.typing_burst`, `app.runtime.sample`. Then open the full trace.

- `list.open` runs from a list row's open action (Home, Mail, Soup lists,
  tasks, CRM) through any notification lookup to the opened view's paint; its
  `navigation` and view are children. `entity.type` says what opened.
- `message.send` runs from a channel composer send to the optimistic message's
  paint opportunity (`message.id`, `channel.id`); delivery stays on the separate
  `channel.send` trace with the same `message.id`.
- `email.send` runs from Send (after the composer's checks) to the sent state;
  `email.send.queued` says whether the durable outbox took it. Early refusals
  are `cancelled`, failures `error`.
- `email.tab` contains the restarted `email.list` flow and its
  `email.list.items` phase; on first load `email.list` is a phase of the mail
  view.
- `calendar.event.open` times opening an event's details (`calendar.event.origin`
  is `grid` or `agenda`).

Traces belong to a sampling class (`apps/web/src/observability/sampling.ts`):
`perf` is kept for 5% of production users and every user in dev, local builds
and explicit native recordings; `always` is kept for everyone. Each class is
decided once per user per class at enablement, from a hash of the signed-in
user id (the document's `frontend_instance_id` before sign-in) salted with the
week, so the cohort rotates weekly; `Telemetry.config.sampled('perf')` reads
it. Spans started before enablement are buffered and placed at export.

A span joins its parent's trace when that trace is exported. Otherwise a phase
(`span.span`) is dropped with it, and any other span starts its own trace when
its own class is kept and is dropped when it is not; a span that asks for no
class is always kept. Unsampled users drop perf traces and install no
runtime-resource or typing listeners, while requests and other spans started
inside a dropped perf trace (`Telemetry.span`) start their own trace instead,
so backend traces are never lost to perf sampling.

### Span model

Every perf trace has one root. Phases are `<area>.<phase>` (`channel.messages`,
`doc.load.context`); nested flows for a mounted subtree end in `.view` when the
area has several (`channel.messages.view`). Names are static: no ids, counts or
content in a name. In Datadog the span name is `resource_name` (the
`operation_name` is the span kind, such as `Internal`), except HTTP client
spans, whose `resource_name` is the method and whose path is `@http.url`. The
`perf-investigation` skill has verified Datadog query shapes.

| Root | `flow.kind` | Started by | `route.id` |
| --- | --- | --- | --- |
| `app.boot` | `boot` | `observability/boot.ts` | The innermost view it opened |
| `navigation` | `navigation` | split-router commit (`runner.ts`) | The innermost view it opened; none when it opened no view |
| `view.<route id>` | `view` | `RouteView` in `split-router/solid/outlet.tsx`; a root only when no navigation is open, otherwise a phase of it | Its route |
| Other `<TraceFlow>` roots (`quick_access.results`, `doc.editor` after the view settled) | `view` | `TraceFlow` | Last opened view |
| `quick_access.open`, `quick_access.input`, `channel.tab`, `form.tab`, `email.tab`, `list.open`, `calendar.event.open` | `interaction` | `beginInteraction` | Last opened view, or the innermost view it opened |
| `database.cell.editor.open`, `database.cell.commit`, `form.submit`, `message.send`, `email.send`, `input.typing_burst` | `interaction` | `startUiOperation` | Last opened view |

`urql.reconcile` and `graphql_cache.ipc.request` are perf-class spans that are
not flows (no `flow.kind`); `app.runtime.sample` is a point sample.

Attributes every perf trace carries, set by the owners (`ui-operation.ts`,
`flow.tsx`, `packages/observability` tracing), not by call sites:

| On | Attributes |
| --- | --- |
| Every span in a classed trace, including HTTP client spans started in it | `macro.sampling.class` (the class it asked for, else its parent's) and `macro.sampling.rate` (that class's rate; weight by its inverse) |
| Roots | `flow.kind`, `route.id` (when known), `ui.operation`, `ui.outcome` (`success`, `cancelled`, `hidden`, `timeout`), `ui.elapsed_ms`, `ui.work_to_ready_ms` (success only), `ui.long_task_count`, `ui.long_task_overlap_ms`, `ui.long_animation_frame_count`, `ui.long_animation_frame_overlap_ms`, `ui.long_animation_frame_blocking_ms`, `ui.visibility`; with an input event, `ui.input_to_ready_ms`, `ui.input_to_paint_opportunity_ms` and `ui.event_*` |
| Flow roots | `flow.phase_count` (child spans opened), `flow.ready_phase_count` (`usePending` phases already loaded when reached) |
| Phases | `flow.root` (the root's name), `route.id` (the nearest view's), `flow.outcome` (`success` or `cancelled`) |
| A phase's parent | `<phase>.waited`: `false` when it was already loaded (cache or an earlier load), `true` when the flow waited for it |
| Resource (Datadog tags and facets) | `service.name=web-app`, `service.version` (Datadog `version`), `deployment.environment` (Datadog `env`), `app.runtime` (`browser`, `tauri`), `app.platform` (`web`, `desktop`, `ios`, `android`), `os.type` (`darwin`, `windows`, `linux`, `ios`, `android`, `chromeos`, `unknown`), `frontend_instance_id` |

Entity context is opaque ids and categories only, on the phase that loads the
entity (`block.type` and `document.id` on `block.data`, `channel.id`,
`entity.type` and `entity.id`); never titles, text, queries or addresses.

Requests join the flow that started them. urql query bindings and TanStack
queries (`lib/queries/flow-trace.ts`) created inside a flow send their request
in that flow's context while it loads; an imperative `client.query` sends its
first request in the span it was called in (`captureTraceParentExchange`). So
`graphql.transport` and `http <method> <path>` spans are descendants of the
flow node and carry `traceparent` to the backend. They hang under the flow
(`view.*` or a nested `TraceFlow`), not under the `usePending` phase that
watches the query. A refetch after the flow settled, and global background
queries (pending sends, Command-K sources), start their own traces.

### Boot (`app.boot`)

Search `{ resource.service.name="web-app" && name="app.boot" }` after a cold
navigation or reload. `app.boot` is an interaction (`beginInteraction` with
`startTime: 0` and `closeOnJoin`) that starts at browser navigation time,
including work before JavaScript evaluated. The router's initial `navigation`
and the first view join it even when the lazy view mounts after the navigation
commits; a first view that unmounts before loading (a redirect) leaves it open
for the next. It finishes at that view's paint opportunity; otherwise `ui.outcome` is
`hidden`, `cancelled` or `timeout` (30 seconds), also copied to `boot.outcome`.

When it finishes, `observability/boot.ts` reconstructs from the Performance API:

- `boot.dns`, `boot.connect`, `boot.tls`, `boot.request`, `boot.response`,
  `boot.dom` from navigation timing, plus `boot.navigation_type`.
- `macro.*` performance marks as events, and `boot.auth.refresh` intervals
  paired from `macro.auth.refresh-start/end`, including refreshes the async
  session entry completed before the provider registered. This is frontend
  timing only; that pre-provider request's backend span is not linked.
- `boot.resource.{script,wasm,font}.{count,encoded_bytes,decoded_bytes,transfer_bytes,duration_ms}`
  aggregates. No resource URLs or per-resource spans are recorded.

Long-task aggregates come from the shared UI-operation observer, like every
other root.

Rendering never waits for telemetry enablement or native diagnostics. The
provider registers immediately and buffers at most 2,048 ended spans; promise
resource attributes (diagnostic identity) still enrich spans that ended early.
Exporters and outgoing trace headers stay off until enablement resolves, and a
denied or failed decision drops the buffer. An explicit native recording keeps
every span and picks its exporter destination.

### Navigation and view phases

Router commits start a `navigation` interaction; each routed view is a
`view.<route id>` flow under it, keyed on route params, so an in-place param
change restarts the flow and its loads are timed like a fresh mount.

Phases you will see:

- Blocks: concurrent `block.component` (lazy module) and `block.data`; routed
  file details use `document.load`. Either passes its span into `doc.load` →
  `doc.load.context` and into the sync socket's `traceparent`. `doc.editor` and
  `doc.editor.initialize` time the editor subtree and its initial sync; snapshot
  phases share the same flow. One open is one navigation/view trace; there is no
  `doc.open` root. `doc.create` ends at navigation and the new view owns the
  load; AI edits have their own `doc.edit` phase.
- Agents: `agent.session.load` (cache read/fold, session fetch, log fetch, fold
  and paint timings) when the view acquires a session; `agent.provision` waits
  for a newly created one; `agent.transcript` waits for the first visible
  transcript, cached or not. An already shared session adds no load span. The
  fold stage includes synchronous listener projection, reported separately as
  `agent.session.load.projection_ms` with its message count; do not add the two.
  A slow fold with a similarly slow projection is main-thread store work, not
  WASM.
- Lists and details: `channel.messages`, `channel.detail`, `email.thread`,
  `database.detail`, `database.rows`, `calendar.target`, `calendar.occurrences`
  (per mounted page), `activity.feed`, `activity.overview`, `home.items`,
  `home.list`, `drive.items`, `reviews.items`, `settings.plan`, shared Soup
  `list.items` / `list.search.remote` / `list.search.local`, and mobile search
  `search.names` / `search.rank` / `search.full-text`.
- Canvas: `canvas.context`, `canvas.location`, `canvas.download` (legacy files
  only), `canvas.parse`, `canvas.sync`.
- CRM: `crm.company` / `crm.contact` keyed by record and section, with
  `crm.record` (metadata) and `crm.items` (enabled record lists), plus
  `crm.personal-views` / `crm.team-views`.
- Forms: `form.tab` contains one `form.build`, `form.responses` or
  `form.settings` child (Responses adds `form.responses.summary` and the grid's
  row phase); `form.layout` times layout initialization. The respondent route
  is `view.form-respond` with `form.detail` and `form.response`; `form.submit`
  runs from Submit to the next paint opportunity, with HTTP below it.
- Channel tabs: `channel.tab` contains the selected `channel.<tab>.view` phase,
  for routed and block channels alike.
- Command-K: `quick_access.open` starts at the hotkey and joins the
  `quick_access.results` flow, whose `quick_access.sources` phase waits for
  sources. `quick_access.input` starts at the input event and contains
  `quick_access.debounce` / `quick_access.sources`; a newer input cancels the
  previous results flow and moves a still-pending source phase to it. For a slow
  `quick_access.search`, compare `quick_access.search_page` with
  `quick_access.materialize` and the `search.page_count`,
  `search.materialized_count` and `search.index.count` attributes;
  `search.index.last_build_ms` is the latest index rebuild, not another phase.
  Only query lengths and counts are recorded. `email.drafts.discover` is
  event-driven local draft discovery, coalescing same-microtask notifications.
- Preloading: block intent records `block.preload` with parallel
  `block.preload.code` and `block.preload.data`; idle warming records
  `block.preload.background`. To check the waterfall, open a document or
  conversation from its list in a fresh session, return, and reopen it: hover,
  focus and pointer press start both the data request and the lazy chunk, and
  background imports wait for the first view and stop during active requests.

### Reading phases

- A phase already settled when its flow reached it emits `<name>.ready` instead
  of a span and sets `<name>.waited=false` on its parent. That means it did not
  wait, not that the cache was hit; use the explicit cache fields on lifecycle
  spans to compare warm and cold. On the root, `flow.ready_phase_count` against
  `flow.phase_count` shows how much of a view was already warm.
- Background refetches after readiness do not extend or reopen a flow.
- Phases overlap (`block.data` and `block.component` run concurrently); never
  add durations together.
- On roots, compare `ui.work_to_ready_ms`, `ui.input_to_ready_ms` and
  `ui.input_to_paint_opportunity_ms` (when an input event was supplied) with
  `ui.long_task_*` and `ui.long_animation_frame_*`. These are a two-frame paint
  opportunity and overlapping main-thread work, not proof a pixel painted or
  that the flow caused every task.
- `flow.outcome=success` means the UI reached readiness, which can be a
  terminal error panel; read connected HTTP spans to tell whether data loaded.
  Exclude cancelled, hidden, timeout and error outcomes from load percentiles.

### Measuring locally

- Use an isolated Playwright Chrome with CDP `Emulation.setCPUThrottlingRate`
  `rate: 4`; warm each route once, then collect at least five opens with the
  same data and viewport. Record the median, dominant phase, long tasks and
  trace ids before and after.
- Never compare a cold Vite module compilation with a warm route, or substitute
  login/error screens for unavailable authenticated surfaces.
- When a before/after table suggests a regression, alternate A/B (or ABBA/BAAB)
  for at least seven samples per version with the same account, content,
  throttle, viewport and view settings; copy local preferences when the
  frontends use different origins. Keep warm-up reloads and CPU profiling out of
  the timed samples, and report paint opportunity and the changed phase
  separately. For layout regressions, also compare CDP layout/style counts.
- Keep injected error probes separate from successful-latency samples.
- Cold-start and warm-cache methodology is in
  [navigation](navigation.md#cold-start-admission).

## Runtime CPU and memory samples

`app.runtime.sample` is a perf-class point sample per ~60 s of visible-tab time
for perf-sampled users. Hiding pauses it, returning starts a fresh window, and
late memory reads from an old window are dropped; back/forward-cache restores
restart it. Group by `app.platform`, `app.runtime`, `os.type` and app version,
and plot against `runtime.session_age_ms` (age of this document, reset on
reload):

- `macro.memory.browser.bytes` (source `user_agent_specific`): browser aggregate
  memory, only when cross-origin isolated and supported. Otherwise
  `macro.memory.js_heap.{used,total,limit}_bytes` (source `js_heap`), Chromium's
  heap estimate, not resident memory. `macro.memory.browser.source` is
  `unavailable` when neither API works.
- `runtime.long_task.ms` and `runtime.long_animation_frame.blocking_ms` over
  `runtime.window_ms`: blocking-work fractions, **not CPU utilization** (short
  tasks, raster and GPU work are missing). Long tasks and LoAF overlap; never
  add them. Unsupported totals are omitted, not zero: check
  `runtime.long_task.supported` and `runtime.long_animation_frame.supported`.
- `runtime.route_views.count`: live route component owners, including hidden
  retained panes and route ancestors, not history snapshots.

The sampler reads the shared UI-operation observer, whose recent-entry buffer
holds 200 entries shared with Event Timing, so busy windows undercount
(`runtime.blocking_work.coverage=bounded_recent_entries`); treat totals as lower
bounds. During an explicit native memory recording, samples reuse `desktop.ts`'s
current native sample, so check `macro.memory.status` (`current`, `stale`,
`pending`), `macro.memory.sample_age_ms` and `macro.memory.frontend.status`
before comparing WebKit footprints with Chromium heap estimates. Native process
memory is collected only for explicit macOS recordings.

The backend-free `resources.html` page in
`apps/web/src/lib/core/util/runtime-browser-test` runs the real provider,
observer and sampler; its button blocks the main thread for 150 ms, so an
exported sample can be checked against a known long task.

## Typing bursts

`input.typing_burst` is one perf-class operation per field burst. It starts at
a marked field's first `beforeinput` (joining its keyboard event when matched)
and ends on field change, blur, hide, disposal, 750 ms without edits
(`typing.quiet_ms`) or the shared 30 s operation limit. Fields opt in with a
static `data-input-surface` category (`typing.surface`): the Lexical wrapper
marks document, composer and other editors, and Command-K and grid text editors
mark themselves. Read-only and unmarked fields never start bursts. No text, key
values, selectors, namespaces or labels are exported.

- `typing.input_count` counts edit events (including paste and composition),
  not key presses, so it can differ from the interaction count.
- `typing.event_{input_delay,processing,duration}_{p50,p95}_ms` summarize Event
  Timing entries that start within the burst: entries are grouped by positive
  `interactionId`, each metric takes the interaction's maximum, then
  percentiles. Pointer entries and entries without an interaction id are
  excluded (the latter counted in `typing.event_timing_unattributed_entry_count`).
  An empty set has no percentiles, never zeros.
- Check `typing.event_timing_supported`, `_threshold_ms` (16 ms: faster events
  are never reported), `_entry_count`, `_interaction_count`,
  `_dropped_timings` (any timing kind evicted from the shared 200-entry buffer,
  not lost inputs), `_coverage` (`unsupported`, `thresholded_window`,
  `buffer_truncated`) and `_delivery` (`available_at_finish`: a blur or timeout
  can finish before later entries arrive) before comparing bursts.
- The span includes the quiet boundary, so its duration is not keystroke
  latency, and these values are not INP. `ui.event_*` describes only the
  opening event. Do not join them with the retired
  `typing.paint_opportunity_*` series.

For local comparisons, capture CDP traces at 4× throttle with about 200 edits
per surface and check that the text reached the intended editor. Keep short
Command-K queries below universal-compose promotion. For large documents use
the collaborative editor fixture described in
[documents](documents.md) and also type in a real app document.
