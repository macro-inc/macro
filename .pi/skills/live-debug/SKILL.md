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

`just run_local` and `just stack up` start two global debugging containers by
default (one per machine, shared across instances, left running):

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

The `grafana` MCP server (`.mcp.json` / `opencode.json`, Docker `mcp/grafana`
on the host network) is pointed at this Grafana. Prefer its tools:

- Logs: `query_loki_logs`, `list_loki_label_values`, `find_error_pattern_logs`
- Traces: `tempo_traceql-search`, `tempo_get-trace`,
  `tempo_get-attribute-values`, `tempo_docs-traceql` (proxied from Tempo's
  own MCP server; every `tempo_*` call needs `datasourceUid: "tempo"`)
- Metrics: `query_prometheus`; plus `search_dashboards`, `generate_deeplink`

Datasource UIDs are stable: `loki`, `prometheus`, `tempo`, `pyroscope`.

The raw HTTP APIs below are the fallback when the MCP is unavailable. Two
timing quirks either way: Loki/Tempo time params are unix epoch
**nanoseconds**, and Tempo's search index flushes every ~30s — a trace you
just produced is fetchable by ID immediately but may not show in search yet.

Find traces (TraceQL — service names are the binary names, e.g.
`email_service`, `document-storage-service`):

```bash
curl -sG http://localhost:3200/api/search \
  --data-urlencode 'q={resource.service.name="email_service" && status=error}' \
  --data-urlencode 'limit=20'
# then fetch one:
curl -s http://localhost:3200/api/traces/<traceID>
```

Match on route, duration, or any span attribute:
`{span.http.route="/documents" && duration>500ms}`.

Read logs with `query_loki_logs`, or by `curl` when the MCP is unavailable
(events carry `trace_id` for correlation):

```bash
curl -sG http://localhost:3100/loki/api/v1/query_range \
  --data-urlencode 'query={service_name="email_service"} |= "error"' \
  --data-urlencode "start=$(date -d '15 minutes ago' +%s)000000000" | jq '.data.result'
# discover services:
curl -s http://localhost:3100/loki/api/v1/label/service_name/values
```

`docker compose -p macro logs -f <service>` still works for raw stdout, but
Loki is queryable and survives container restarts.

Verbosity knobs (set in the shell before `just run_local`, or per service in
Doppler): `RUST_LOG` filters console + Loki output; `OTEL_TRACE_FILTER`
independently filters exported spans (default `info`). Lowering `RUST_LOG`
never silences traces.

## Drive the shared headless Chrome

A headless Chrome runs in Docker with CDP on 9222. The `chrome-devtools` MCP
server (`.mcp.json` / `opencode.json`) is already pointed at it — prefer its
tools (navigate, snapshot, click, evaluate, console, network) for browser
work. State (cookies, login) persists across agent sessions until the
container restarts.

- The container uses host networking, so plain localhost URLs work: the app
  is **http://localhost:3000/app**, the proxy `http://localhost:8090`.
- Login is passwordless: any email works, and the login API returns the code
  in its response (also visible in Mailpit at http://localhost:8025).
- From Playwright instead: `chromium.connectOverCDP('http://localhost:9222')`.
  For token-injection and route-interception recipes see
  `apps/web/docs/playwright-debugging.md`.

Correlate a browser repro with backend traces: note the time, then search
Tempo for that window — the browser's `traceparent` means the frontend action
and the Rust handler share one trace ID.

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
