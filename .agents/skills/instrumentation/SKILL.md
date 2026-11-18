---
name: instrumentation
description: >-
  Add OpenTelemetry tracing to a new flow or hot path, frontend or backend.
  Use when building a user-facing flow, a cross-service call, a queue or
  background job, or code on a latency-sensitive path; when adding spans,
  span attributes, or trace propagation; or when a trace in Tempo/Datadog is
  missing, disconnected, or opaque.
---

# Instrumentation

New flows and hot paths ship instrumented, in the same change. The standard is
the [observability rule](../../rules/observability.md): one connected trace from
the user's action through every service, with phases timed and the entity id on
the spans. This skill is how to meet it.

## Pick the shape first

Before writing code, sketch the trace you want to read during an incident:

```text
navigation                    (browser interaction)
└─ view.<route>               (caller-owned loading flow)
   ├─ document.load / block.data
   │  └─ doc.load → doc.load.context (HTTP → DSS)
   ├─ doc.snapshot.*
   └─ doc.editor
      └─ doc.editor.initialize (initial sync → editor ready)
```

One root span per user action, one child per phase a reader would ask about
(network, queue wait, processing, each external call), and the id you'd search
by on the root.

## Frontend and Cloudflare Workers

Use the `@macro-inc/observability` facade (`packages/observability`); never
import OpenTelemetry directly.

- `Telemetry.span(name, fn)` for a phase; `span.span(name, fn)` for a child.
  `Telemetry.span(name, { kind: 'client' })` for an outbound call, then
  `span.injectTraceHeaders(headers)`.
- `Telemetry.span(name, { sampling: 'perf' })` puts a trace in a sampling
  class; without one it is always kept. See
  [What gets exported](#what-gets-exported).
- `span.setAttr(key, value)` for ids and counts; `span.error(message)` on
  failure; manual spans must `end()` on every path.
- The browser uses a synchronous `StackContextManager`, so after an `await`
  call `parent.span(...)`, or wrap later dispatch in `parent.run(...)`; see the
  rule for `Telemetry.captureContext()`.
- Share a caller-owned span through flow context and explicit client
  parameters (`parentSpan`). Never keep entity-keyed span registries or end
  another owner's span.
- Transports without headers carry `span.traceparent()` another way, such as a
  WebSocket query parameter.
- Workers wrap their handler with `instrument()` and `createWorkerTraceConfig`
  from `@macro-inc/observability/worker`, which adopts the incoming
  `traceparent`.

## Frontend view loading

Use `@app/observability/flow` for user-visible loading. A flow is a span that
stays open while anything under it is loading and ends one paint after the last
hold releases.

- **Views are roots already.** Router commits start a `navigation` interaction
  and every routed view is a `view.<route id>` `<TraceFlow>` keyed on its
  params (`RouteView` in `split-router/solid/outlet.tsx`). Don't add one per
  route; add phases inside it.
- **Phases: `usePending(name, accessor)`**, right after creating the query,
  e.g. `usePending('channel.messages', () => query.isLoading)`. While the
  accessor is true it holds the flow as a child span; it can start again each
  time the flow is open. Already false when the flow reaches it (a cache hit or
  an earlier view's load) records a `<name>.ready` event and
  `<name>.waited=false` instead of a span; a real wait sets
  `<name>.waited=true` on the parent. Read status only: reading pending
  `query.data` suspends the enclosing shell. Track initial loading, not
  background refreshes or a disabled query that cannot complete.
- **Nested flows:** `<TraceFlow name="doc.editor">` around an independently
  loaded subtree, placed **inside** its Suspense boundary (outside it the flow
  can settle while the fallback shows). A view can hold several. Pass `key` to
  restart it when the subtree shows a different entity in place; pending
  phases move to the new run. Unmounting before it settles ends it, and its
  open phases, as `flow.outcome=cancelled`.
- **Async phases: `useFlow()`** during component setup, then
  `flow.task('block.data', async (span) => ...)` for imperative loading. It
  holds the flow until the promise settles and runs the synchronous start in
  the child's context. A span alone does not hold the flow; give that work a
  `usePending` or `task`.
- **Requests in the flow:** urql and TanStack queries created inside a flow
  already send in its trace. Start any other request inside
  `flow.run(() => ...)`, or hand `useFlowTrace()` to a transport that sends
  later.
- **No Zone across `await`.** The browser's `StackContextManager` keeps context
  only synchronously. After an await call `span.span(...)`, or wrap later work
  in `span.run(...)`; capture `Telemetry.captureContext()` at synchronous
  admission (before auth or queueing) and `.run(...)` the send in it.
- **User actions: `beginInteraction('channel.tab')`** for an in-view action
  that mounts content without navigation: update state, then `.end()` in a
  `finally`. The window is synchronous; flows created inside it join it. Use
  `startUiOperation` directly only for a measured action that mounts no flow (a
  cell commit, a submit), calling `afterPaint()` once the UI updated.
- **Sampling** is per trace; see [What gets exported](#what-gets-exported).
- `flow.kind`, `route.id`, `flow.root`, `flow.outcome`, `<phase>.waited`,
  `macro.sampling.*` and the `ui.*` timing fields come from the owners; never
  set them per call site. Keep names static and attributes to opaque ids,
  categories and counts. No flow per message, row or cell; measure the
  containing view.

Flows never schedule application work; preloading and warm-up own their own
gates.

### Example: a view with two phases

The database block holds its view with two phases, the table's metadata and
its first rows (`block-database/component/Block.tsx`, `DatabaseGrid.tsx`):

```tsx
function DatabaseDetail(props: { databaseId: string }) {
  const detailQuery = useDatabaseDetailQuery(() => props.databaseId);
  usePending('database.detail', () => detailQuery.isLoading);
  return (
    <Suspense fallback={<GridSkeleton />}>
      <DatabaseGrid detail={detailQuery.data} />
    </Suspense>
  );
}

function DatabaseGrid(props: { detail: DatabaseDetail | undefined }) {
  const source = useTableRows(() => props.detail);
  usePending('database.rows', source.loading);
  // ...
}
```

Opened from a list this exports `navigation → view.<route id> →
{database.detail, database.rows}`, with the HTTP and server spans under each
phase. In Datadog, the root is `service:web-app @macro.sampling.class:perf
resource_name:navigation @route.id:<route id> @ui.outcome:success`; read
`@ui.elapsed_ms` (input to paint) and split by `@flow.kind` to compare entry
points. On the view span, `@database.rows.waited:false` marks rows served from
the cache; phase durations are `resource_name:database.rows
@flow.outcome:success`, with `@flow.root` naming the root. The
`perf-investigation` skill has the tested query shapes, and the
[observability walkthrough](../../../docs/agent-guide/observability.md#web-performance-traces)
lists every root and attribute.

## What gets exported

Four layers decide whether a span reaches Datadog:

1. **The global gate.** Built apps (browser and desktop) export only where
   the `enable-browser-otel` PostHog flag is on; the Vite dev server exports
   whenever a collector is configured, and `VITE_ENABLE_BROWSER_OTEL`
   overrides both (`observability/browser.ts`). Spans are buffered from boot
   and exported once enablement resolves; nothing is sent before it.
2. **Unclassed spans: always exported** once the gate is open. A
   `Telemetry.span(name)` with no `sampling` option. Use this for requests,
   errors, mutations, background work and anything a backend trace hangs off:
   `safeFetch` HTTP spans, `graphql.mutation_queue.attempt`, `channel.send`.
3. **Sampling classes**, declared by the app in
   `apps/web/src/observability/sampling.ts` with their rates:
   - `perf` (5% of production users, every user elsewhere): performance
     measurement. Flows, `beginInteraction`, `startUiOperation`,
     `app.boot`, `input.typing_burst`, `app.runtime.sample`,
     `urql.reconcile`. This is the default for `<TraceFlow>`,
     `beginInteraction` and `startUiOperation`.
   - `always` (every user): a span that must survive a dropped `perf` trace
     under a class of its own.

   Each class is decided once per user per class at enablement, from the user
   id (the `frontend_instance_id` before sign-in) salted with the week, so the
   cohort rotates weekly; `Telemetry.config.sampled('perf')` reads it, and
   explicit native recordings keep every class. Exported spans in a classed
   trace carry `macro.sampling.class` and `macro.sampling.rate` (weight counts
   by `1 / rate`).

   Nesting: a span joins its parent's trace when that trace is exported.
   Otherwise a phase (`span.span`, `usePending`, `flow.task`) is dropped with
   its root, and any other span starts its own trace when its own class is kept
   (an unclassed span always is) and is dropped when it is not. So requests
   started inside an unsampled perf trace still export as their own traces,
   and their backend spans are never lost to perf sampling.
4. **Backend.** Rust services and workers do not sample themselves: they
   follow the incoming `traceparent`'s sampled flag (OpenTelemetry's default
   parent-based sampler) and export the rest. Datadog then indexes a subset of
   ingested spans; the perf retention filter in
   `infra/stacks/monitoring/dashboards/web-performance.ts` keeps exported perf
   traces searchable.

**Picking a class.** Timing a view, phase or user action to rank or compare
latency: use a flow or interaction (`perf`). Something that must be there to
debug one user's failure, or that a backend trace joins: leave it unclassed. A
new class belongs in `sampling.ts` with a rate, and only for a new kind of
telemetry with its own volume budget.

## Rust services

- HTTP handlers already get spans from `macro_tower_layers`; outbound HTTP calls
  `macro_tower_layers::inject_trace_headers`.
- `#[tracing::instrument(skip_all, fields(document_id = %id), err)]` on domain
  operations and outbound adapters (CS-22: `err` only on `Result`, no
  `level = "info"`).
- Kafka: `kafka_util` injects trace headers on publish; consumers open
  `kafka_util::consumer_span` and call `record_span_error` on failure.
- Agent/ACP messages: `genai_telemetry::propagation::inject` / `set_parent`
  carry context in `_meta`; GenAI spans follow CS-55.
- Spawned tasks take the span with them (`.instrument(span)`) or link to it.
- Datadog files a client span that carries an HTTP method as operation
  `http.client.request` with resource `<METHOD> <url.template>`, whatever the
  span is called; set `operation.name` on it to keep it findable by name
  (`outlook.graph_request` does). Internal spans keep their name as
  `resource_name`.
- Record numeric span fields as `i64`: `tracing-opentelemetry` has no
  unsigned type and exports `u16`/`u32`/`u64`/`usize` values as strings.
- Background loops start one root span per claimed unit of work, not per poll,
  so idle polling exports nothing.

## Worked examples

**Document open lifecycle (web → DSS → sync-service).**
`BlockLoader` and `FileDetailLoadGate` own loading tasks and pass their span to
Markdown loaders. The loader times `doc.load` → `doc.load.context` and passes
context to its sync source. The editor and collaboration adapter use the
nearest flow context; collaboration reports ready without ending the caller's
span. No `doc.open` root or document-id span registry is created.
`packages/collaboration/src/collab/telemetry.ts` stamps
`document.id` and `session.id` on `doc.seed`, `doc.sync.catchup`, and
`edit.apply`. The sync WebSocket carries `traceparent` as a query parameter,
which sync-service reads with `worker_rs_otel::traceparent_from_request`.

**Agent editing (web or Rust → ai-editing-worker → sync-service).**
The web client (`apps/web/src/lib/service-clients/ai-editing-worker/client.ts`)
opens `http POST /edit` under the document's span; Rust callers
(`crates/documents/src/outbound/editing_worker_client.rs`) inject headers from
an instrumented method. The worker
(`services/ai-editing-worker/src/endpoints/edit.ts`) roots an `edit.session`
with outcome fields (`edit.mode`, `edit.ops_total`, `edit.blocked`,
`edit.aborted`), then a child per phase: `edit.sync_init`, `edit.hydrate`,
`edit.interpret`, `edit.supervise.turn`, `edit.dispatch`, `edit.run_code`,
`edit.flush`. On the agent side, `crates/agent_session/src/domain/session/telemetry.rs`
emits `invoke_agent` and `execute_tool` and propagates into the ACP agent.
Every `execute_tool` span says who called it: `macro.genai.tool.host` (the
agent loop's name, the session's harness, or `public_mcp`),
`macro.genai.tool.mode` (`code`/`standard`), `macro.genai.turn.purpose`, and
for public MCP `macro.genai.mcp.caller` and `macro.genai.mcp.client.name`
(`ai_toolset::ToolCallOrigin`).

**GraphQL mutation queue (web → DSS `graphql.execute` → resolver).**
`apps/web/src/lib/graphql-cache/exchange/mutation-queue-telemetry.ts` opens a
`graphql.mutation_queue.attempt` span per claimed attempt that actually sends
(`mutation_queue.item_id`, operation name, attempt count, queue depth, oldest
item age, auth/online/websocket state, `mutation_queue.outcome`,
`mutation_queue.failure`, `graphql.error.code`). Ages come from the durable
enqueue time (`enqueuedAtMs`), so they survive reloads; when it is missing or
skewed, `mutation_queue.age_known` is false and the age is omitted rather than
zero. The runner sends inside it, so
`dssGraphqlFetch` injects `traceparent` and the DSS `graphql.execute` span and
the instrumented resolvers (`crates/graphql_entity_mutation`,
`graphql_properties`, `graphql_notification`) join the same trace. A loop that
can repeat forever reports counters instead of lines: each item logs a failure
class once, and `graphql.mutation_queue.summary` flushes counters every five
minutes only when something non-routine happened.

## Reading production

To find slow flows in Datadog from these spans, use the `perf-investigation`
skill.

## Verify

Run the flow on the local stack and find its trace (see the `live-debug`
skill): one trace from browser to the last service, each phase visible with its
duration, findable by the entity id, and failures marked as errors. Report the
trace as verified or say it wasn't.
