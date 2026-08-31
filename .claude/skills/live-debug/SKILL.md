---
name: live-debug
description: >-
  Debug the running local stack with traces, logs, and a shared headless
  browser. Use when investigating a bug in a running service, tracing a
  request across services, reading service logs, reproducing a frontend issue,
  or writing/reviewing tracing instrumentation.
allowed-tools: Bash, Read, Grep, Glob
---

# Live debugging

`just run_local` and `just stack up` start the LGTM collector by default and
the agent browser with `--with-chrome` (both global: one per machine, shared
across instances, left running):

| Endpoint | What |
| --- | --- |
| http://localhost:3001 | Grafana (anonymous admin) — traces + logs UI |
| http://localhost:3200 | Tempo API — traces |
| http://localhost:3100 | Loki API — service logs |
| http://localhost:9090 | Prometheus API — metrics |
| localhost:4317 / 4318 | OTLP intake (gRPC / HTTP), alias `otel-collector` |
| http://localhost:9222 | Headless Chrome (CDP) |

`--traces off` disables the collector; `--traces jaeger|datadog` swaps it.
All collectors bind 4317/4318 — exactly one runs at a time.

Every Rust service exports spans AND its `tracing` events (as correlated log
records) over OTLP. The frontend exports browser spans through the proxy and
propagates `traceparent`, so one trace covers browser → proxy → services.
Wiring happens at stack start: if you start a collector by hand, restart the
stack to pick it up.

## Query telemetry (prefer APIs over the Grafana UI)

The `grafana` MCP server (`.mcp.json` / `opencode.json` / `.cursor/mcp.json`,
Docker `mcp/grafana` on the host network) is pointed at this Grafana. Prefer its tools:

- Logs: `query_loki_logs`, `list_loki_label_values`, `find_error_pattern_logs`
- Traces: `tempo_traceql-search`, `tempo_get-trace`,
  `tempo_get-attribute-values`, `tempo_docs-traceql` (proxied from Tempo's
  own MCP server; every `tempo_*` call needs `datasourceUid: "tempo"`)
- Metrics: `query_prometheus`; plus `search_dashboards`, `generate_deeplink`

Datasource UIDs are stable: `loki`, `prometheus`, `tempo`, `pyroscope`.

Typical calls — service names are the binary names (`email_service`,
`document-storage-service`); match on route, duration, or any span attribute:

- `tempo_traceql-search` `{datasourceUid: "tempo", query: '{resource.service.name="email_service" && status=error}'}`
  (also `'{span.http.route="/documents" && duration>500ms}'`), then
  `tempo_get-trace` with the returned trace ID. Searches default to the past
  hour; widen with RFC3339 `start`/`end`.
- `query_loki_logs` `{datasourceUid: "loki", logql: '{service_name="email_service"} |= "error"'}`
  — log lines carry `trace_id`/`span_id` for correlation. Discover services
  with `list_loki_label_values` on `service_name`.

Timing quirks: Tempo's search index flushes every ~30s — a trace you just
produced is fetchable by ID immediately but may not show in search yet.

Everything above is also plain HTTP: TraceQL search at
`http://localhost:3200/api/search?q=<traceql>`, trace fetch at
`/api/traces/<id>`, LogQL at
`http://localhost:3100/loki/api/v1/query_range?query=<logql>` (`start`/`end`
are unix epoch **nanoseconds**). Use the HTTP form when there is no MCP (pi),
and for bulk retrieval you want to reduce before reading — a full trace can
be 50+ spans, so `curl /api/traces/<id> | jq` (filter to slow spans, compute
offsets) beats dumping `tempo_get-trace` output into context. `docker compose
-p macro logs -f <service>` still works for raw stdout, but Loki is queryable
and survives restarts.

Verbosity knobs (set in the shell before `just run_local`, or per service in
Doppler): `RUST_LOG` filters console + Loki output; `OTEL_TRACE_FILTER`
independently filters exported spans (default `info`). Lowering `RUST_LOG`
never silences traces.

## Drive the shared headless Chrome

`--with-chrome` runs a headless Chrome in Docker with CDP on 9222 (if 9222
doesn't answer, start it: the compose command is in the `headless-chrome`
comment in `docker/docker-compose.yml`). The `chrome-devtools` MCP server
(`.mcp.json` / `opencode.json` / `.cursor/mcp.json`) is already pointed at
it — prefer its tools (navigate, snapshot, click, evaluate, console, network) for browser
work. State (cookies, login) persists across agent sessions until the
container restarts.

- The container uses host networking, so plain localhost URLs work: the app
  is **http://localhost:3000/app**, the proxy `http://localhost:8090` (named
  instances remap these ports; read the stack summary).
- A human can watch the browser live at **http://localhost:6080/vnc.html**
  (noVNC over the Xvfb display) — work in the visible window, not isolated
  contexts, when someone may be watching.
- Login is passwordless: any email works, and the login API returns the code
  in its response (also visible in Mailpit at http://localhost:8025).
- From Playwright instead: `chromium.connectOverCDP('http://localhost:9222')`.
  For token-injection and route-interception recipes see
  `apps/web/docs/playwright-debugging.md`.

Correlate a browser repro with backend traces: note the time, then search
Tempo for that window — the browser's `traceparent` means the frontend action
and the Rust handler share one trace ID.

### chrome-devtools technique

- Snapshot-first: `take_snapshot` after every navigation or pane change; act
  only on uids from the latest snapshot (uid prefixes bump on re-render).
  Macro snapshots are huge — split panes duplicate the doc text — so save
  big ones to a file (`filePath` param) and grep them.
- `navigate_page` can time out while the SPA actually loaded (cold Vite
  compile); follow with `wait_for` on expected text instead of re-navigating.
- `wait_for` matches any text presence, including placeholders. For "AI
  finished"-style conditions, poll in `evaluate_script` for the Stop
  button's absence — the only reliable completion signal.
- `fill` works on plain inputs but NOT contenteditable: click to focus, then
  `type_text` (Enter splits paragraphs/sends). Combobox token fields need
  type → wait for the "N options available" live region → Enter to tokenize.
- If a radio/tab control won't click ("did not become interactive"), click
  its adjacent label text node instead.
- On any error dialog or blank state: `list_console_messages` +
  `list_network_requests` (filter xhr/fetch), then `get_network_request` for
  the failing request's body — pairing console error with failing request
  localizes the fault in one step.
- Verify editor state with `evaluate_script` (e.g. query
  `[contenteditable] strong` to confirm an AI edit) — cheaper and more
  precise than screenshots.

### Driving the Macro app

The condensed version is below; the full field-tested guide (routes, every
surface, keyboard model, crash recovery, trace correlation from a network
request's `traceparent`) is `docs/AGENT_GUIDE/`.

- Unauthenticated users land on `/app/welcome`: "Continue with email" → fill
  the email input → "Continue". Locally this may log in with no code prompt;
  otherwise the code is in Mailpit. First login auto-creates the user.
- Documents live at `/app/md/<uuid>`; a doc-scoped AI chat at
  `/app/md/<uuid>/chat/<chatId>`; split panes give the right pane its own URL
  segment (`/app/md/<uuid>/channel/<channelId>`).
- Everything is created via the top-left "Create" button (Document D,
  Channel G, Message M, Task T, …). Sidebar buttons are named "Go to X" in
  the a11y tree. Search is the "Search" button — results appear as you type,
  no Enter.
- Editor: title field is focused on creation; type the title, Enter moves
  into the body. The contenteditable's a11y `value` exposes the full body
  text, so snapshots double as content verification.
- AI edit: "Edit with AI" button under the editor → type the instruction →
  Enter. Edits apply in place; done when the "Stop" button disappears.
  AI chat: "Ask Macro" in the doc's Actions panel (doc pre-attached), Enter
  sends, "Stop generating" disappears when the response is complete.
- Channels: "Create" → Channel → name it, tokenize invitees in the "To:"
  combobox, "Create Channel". Verify membership in the Participants tab.
  Composer: Enter sends; the "Task" switch turns a message into a task.

## Write tracing code that is debuggable

Follow CLAUDE.md's tracing rules (`err` on `Result`-returning `#[instrument]`,
never `level = "info"`, `tracing::error!(error=?e, "msg")`, prefer
`.inspect_err`). Beyond those:

- Instrument boundaries, not plumbing: HTTP handlers get spans from
  `macro_tower_layers`; add `#[tracing::instrument]` to queue consumers,
  cross-service client calls, and multi-step business operations — the places
  a trace would otherwise go dark.
- Skip bulky args (`#[instrument(skip(payload), fields(document_id = %id))]`)
  and record the IDs you will actually search by: entity IDs, user IDs,
  counts. A span you can't find by ID is a span you can't use.
- Record late-known values with `tracing::Span::current().record(...)` rather
  than emitting a second event.
- Events inside a span inherit its trace: one `tracing::warn!` with fields
  beats three unstructured `debug!`s. Fields, not format strings —
  `warn!(attempts, "retrying")`, not `warn!("retrying attempt {attempts}")`.
- Verify your instrumentation live: run the code path, then confirm the span
  shows up in Tempo with the fields you expect. Unverified instrumentation is
  the usual reason "the trace was empty" during a real incident.
