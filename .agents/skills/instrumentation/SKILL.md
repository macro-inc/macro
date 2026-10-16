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
doc.open                      (browser, root, document.id)
├─ doc.load
│  └─ doc.load.context        (HTTP → DSS, traceparent header)
├─ doc.seed / doc.sync.catchup
└─ sync-service connect       (WebSocket, traceparent query param)
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
- A flow that spans components or outlives one call keeps its root span in a
  registry keyed by entity id and resumes it later (see the document example).
- Transports without headers carry `span.traceparent()` another way, such as a
  WebSocket query parameter.
- Workers wrap their handler with `instrument()` and `createWorkerTraceConfig`
  from `@macro-inc/observability/worker`, which adopts the incoming
  `traceparent`.

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
`apps/web/src/features/block-md/definition.ts` starts or resumes `doc.open`
(`document.id`, `doc.type`) and times `doc.load` → `doc.load.context`.
`apps/web/src/features/block-md/observability.ts` keeps open document spans by
id so the launcher's `doc.create`, the collab provider, and the sync client all
attach to one trace. `packages/collaboration/src/collab/telemetry.ts` stamps
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

## Verify

Run the flow on the local stack and find its trace (see the `live-debug`
skill): one trace from browser to the last service, each phase visible with its
duration, findable by the entity id, and failures marked as errors. Report the
trace as verified or say it wasn't.
