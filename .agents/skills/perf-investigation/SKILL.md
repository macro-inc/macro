---
name: perf-investigation
description: >-
  Find which web or desktop app flows are slow, for whom, and why, using the
  Datadog MCP over the app's perf traces. Use when asked why the app, a view,
  boot, navigation or an interaction is slow, to rank slow flows, to compare
  platforms, OSes or versions, to check a performance change after a deploy,
  or to map a slow span to its code.
---

# Perf investigation

The web app (`service:web-app`, browser and Tauri desktop) exports perf-class
traces: one root per boot, navigation, view or interaction, a child per phase,
and HTTP spans that join backend services. Span names and required attributes
are the [span model](../../../docs/agent-guide/observability.md#span-model);
read it first. The dashboard is "Web app performance"
(`infra/stacks/monitoring/dashboards/web-performance.ts`).

## How web-app spans look in Datadog

Verified against production web-app spans:

- The span name is `resource_name`. `operation_name` is the span kind
  (`Internal`, `http.client.request`); never group by it. HTTP client spans
  (`http <METHOD> <path>` in Tempo) are `operation_name:http.client.request`
  with the method as `resource_name`; group them by `@http.url` (no query string)
  and time them with `@http.response_headers_ms`.
- Span attributes are `@<attribute>` (`@route.id`, `@flow.kind`,
  `@ui.work_to_ready_ms`). Resource attributes are facets too: `@app.platform`
  (`web`, `desktop`, `ios`, `android`), `@app.runtime`, `@os.type`,
  `@version` (group by `@version`; bare `version` returns nothing), and
  `env` (`prod`, `development`, `dev`).
- Numeric attributes are measures (`pc75` over `@ui.elapsed_ms` works).
  Booleans arrive as strings: `@agent.session.load.cache_hit:true`.
- `@duration` is nanoseconds; `ui.*_ms` fields are milliseconds; trace metrics
  (`trace.Internal`) are seconds.
- Grouping by a facet a span lacks drops that span from the result. Pass
  `missing: "unknown"` in the SDK `groupBy` (the `aggregate_spans` tool cannot).
  Spans from builds before `os.type` shipped in browsers have it only on desktop;
  `@otel.user_agent:*Macintosh*` / `*Windows*` / `*Linux*` splits those.
- Span search and aggregation see indexed spans only. The perf retention
  filter keeps every exported perf trace once deployed; without it, counts are
  a sample (diversity plus 1% flat). Use the `macro.web.*` span-based metrics
  or `trace.Internal{service:web-app} by {resource_name,version}` (roots only,
  100% of ingested spans) for volume and percentiles.
- DSS spans are `service:cloud-storage-service` in Datadog.

## Pitfalls

- Production exports perf traces for 5% of sessions, and only where the
  `enable-browser-otel` PostHog flag is on. Small routes have few samples:
  report counts with every percentile.
- Perf spans exist only from the release that shipped them; check `@version`
  before concluding a flow is fast or missing.
- Exclude non-success outcomes from load percentiles: roots
  `@ui.outcome:success`, phases `@flow.outcome:success`. Views are roots
  (`@flow.kind:view`) or phases of `navigation`/`app.boot`; filter by
  `resource_name:view.*` to get both.
- Phases overlap; never sum them. `<phase>.waited:false` means it was already
  loaded, not necessarily a cache hit.
- `ui.long_task_*` and `ui.long_animation_frame_*` overlap each other and are
  not CPU time.

## Workflow

Load `datadog/traces` once, then run each step as one `execute_code` script.
`agg` is reused below:

```javascript
import { client, v2 } from "@datadog/datadog-api-client";
const spans = new v2.SpansApi(client.createConfiguration());
const agg = (filter, compute, groupBy = []) =>
  spans.aggregateSpans({ body: { data: { type: "aggregate_request",
    attributes: { filter: { from: "now-7d", to: "now", ...filter }, compute, groupBy } } } })
  .then((r) => r.data.map((b) => ({ by: b.attributes.by, ...b.attributes.compute })));
```

**1. Rank flows** by p75/p95 and volume:

```javascript
return agg(
  { query: "service:web-app env:prod @macro.trace.class:perf @flow.kind:* @ui.outcome:success" },
  [ { aggregation: "count", type: "total" },
    { aggregation: "pc75", metric: "@ui.elapsed_ms", type: "total" },
    { aggregation: "pc95", metric: "@ui.elapsed_ms", type: "total" } ],
  [ { facet: "resource_name", limit: 30,
      sort: { type: "measure", aggregation: "pc95", metric: "@ui.elapsed_ms", order: "desc" } } ]);
```

Views (roots and phases): query `resource_name:view.* -@flow.outcome:cancelled
-@ui.outcome:(cancelled OR hidden OR timeout)`, metric `@duration`, group by
`@route.id`.

**2. Split the slow flow** by who sees it: add `groupBy` entries for
`@app.platform`, `@os.type`, `@app.runtime` and `@version`, each with
`missing: "unknown"`, filtered to its `resource_name`. For trends, use
`type: "timeseries", interval: "12h"` on every compute.

**3. Break it into phases.** Phases carry the root's name, so aggregate them
without trace queries:

```javascript
return agg(
  { query: "service:web-app env:prod @flow.root:navigation @route.id:view-mail @flow.outcome:success" },
  [ { aggregation: "count", type: "total" },
    { aggregation: "pc75", metric: "@duration", type: "total" } ],
  [ { facet: "resource_name", limit: 30,
      sort: { type: "measure", aggregation: "pc75", metric: "@duration", order: "desc" } } ]);
```

Then fetch exemplars at the slow tail and read their trees:

```javascript
const list = await spans.listSpansGet({
  filterQuery: "service:web-app env:prod resource_name:view.view-mail @duration:>2000000000",
  filterFrom: "now-1d", filterTo: "now", sort: "-timestamp", pageLimit: 5 });
return list.data.map((s) => ({ trace: s.attributes.traceId, ns: s.attributes.custom?.duration }));
```

`get_datadog_trace` with each `trace` id gives every span's start and duration;
compute each phase's offset from the root's start and look for the longest
serial gap, not the longest span. Compare the root's `flow.ready_phase_count`
and the `<phase>.waited` fields between fast and slow exemplars to separate
cold loads from slow ones.

**4. Correlate with the backend.** The same trace holds the
`http <METHOD> <path>` and `graphql.transport` client spans and the server
spans under them (`only_service_entry_spans: true` to summarise). Compare the
client span with its server child: a large gap is network, queueing or auth
refresh (`boot.auth.refresh`, `http POST /auth/jwt/refresh`), not the
handler. To rank the endpoints perf traces wait on, aggregate
`service:web-app @macro.trace.class:perf operation_name:http.client.request`
by `@http.url` over `@http.response_headers_ms`.

**5. Main thread and resources.** On roots, compare `@ui.work_to_ready_ms`
with `@ui.long_animation_frame_blocking_ms` and `@ui.long_task_overlap_ms`:
blocking close to the elapsed time means the main thread, not the network.
`resource_name:app.runtime.sample` carries `@macro.memory.js_heap.used_bytes`,
`@runtime.long_animation_frame.blocking_ms` and `@runtime.session_age_ms`;
bucket by session age with a histogram group:

```javascript
return agg(
  { query: "service:web-app env:prod resource_name:app.runtime.sample" },
  [ { aggregation: "pc75", metric: "@macro.memory.js_heap.used_bytes", type: "total" },
    { aggregation: "count", type: "total" } ],
  [ { facet: "@runtime.session_age_ms",
      histogram: { interval: 600000, min: 0, max: 7200000 }, limit: 20 } ]);
```

Typing latency: `resource_name:input.typing_burst`, measure
`@typing.event_duration_p95_ms`, group by `@typing.surface`.

**6. Map the span to code.** Search the span name: `rg "'channel.messages'"
apps/web/src` finds the `usePending`/`TraceFlow`/`beginInteraction` owner;
`view.<route id>` comes from `lib/split-router/solid/outlet.tsx` with the
route defined in the router; `http <METHOD> <path>` is the request path. The
instrumentation skill explains each primitive.

## Verify locally first

Before relying on a new or renamed span in Datadog, run the flow on a local
stack and find it in Tempo (`live-debug` skill): `{ span.flow.kind != nil }`
lists roots, `{ span.flow.root = "navigation" }` its phases. Local traces are
100% sampled. Perf data reaches Datadog only after the release ships.

Report: the flows ranked (with counts), who is affected, the dominant phase or
blocking work with exemplar trace links, the owning code, and what the sample
size cannot tell.
