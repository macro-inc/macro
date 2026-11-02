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
  `Telemetry.clientSpan(name)` for an outbound call, then
  `span.injectTraceHeaders(headers)`.
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

Use `@app/observability/flow` for user-visible loading. Router commits start a
`navigation` interaction and every routed view is already a `view.<route id>`
`<TraceFlow>` keyed on its params. Flows are perf-class traces, sampled per
session.

- `usePending('channel.messages', () => query.isLoading)` right after creating
  the query adds a phase that holds the flow while it is true. Read status only:
  reading pending `query.data` suspends the enclosing shell. Track initial
  loading, not background refreshes or a disabled query that cannot complete.
- `<TraceFlow name="doc.editor">` around an independently loaded subtree, placed
  **inside** its Suspense boundary, adds a nested flow; outside it, the flow can
  settle while the fallback is visible. Pass `key` to restart it when the
  subtree shows a different entity in place.
- `const flow = useFlow()` during component setup; then
  `flow.task('block.data', async (span) => ...)` for imperative loading. It
  holds the flow until the promise settles and runs the synchronous start in
  the child's context; use `span.span(...)` after an await. `flow.span` passes
  the flow to lifecycle code and clients. A span alone does not hold the flow
  open; give that work a `usePending` or `task` too.
- For in-view actions that mount content without navigation,
  `beginInteraction('channel.tab')`, update state, then `.end()` in a `finally`.
  The window is synchronous: don't hold it across an unrelated await. Flows
  created inside it join it; wrap the newly mounted content in a flow.
- Use `startUiOperation` directly only for a measured action that mounts no
  flow (a cell commit, a submit); call `afterPaint()` once the UI updated.
- urql and TanStack queries created inside a flow already send their requests
  in its trace. For another request a component starts during the load, start
  it inside `useFlow().run(...)`, or hand `useFlowTrace()` to a transport that
  sends later.
- `flow.kind`, `route.id`, `flow.root`, `flow.outcome`, `<phase>.waited` and
  the `ui.*` timing fields come from the owners; never set them per call site.
  The [span model](../../../docs/agent-guide/observability.md#span-model) lists
  them.
- Keep names static and attributes to opaque ids, categories and counts. No
  flow per message, row or cell; measure the containing view.

Flows never schedule application work; preloading and warm-up own their own
gates. Reading the resulting traces (`.ready` events, overlapping phases,
`ui.*` fields, sampling) is covered in the
[observability walkthrough](../../../docs/agent-guide/observability.md#web-performance-traces).

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

## Verify

Run the flow on the local stack and find its trace (see the `live-debug`
skill): one trace from browser to the last service, each phase visible with its
duration, findable by the entity id, and failures marked as errors. Report the
trace as verified or say it wasn't.
