---
description: "Changes to a flow carry the instrumentation to debug it: one correlated trace across services, spans at boundaries, timing, and searchable IDs."
alwaysApply: true
---

# Observability

Every new or changed flow must be debuggable from its trace alone: one trace from
the user's action through every service it touches, with the timing and IDs needed
to answer "what happened to this request and where did the time go". Reviewers
treat missing instrumentation on a new flow as a defect, like a missing test.
New flows and hot paths are instrumented in the same change, frontend and
backend. The document open lifecycle (`doc.open`) and agent editing
(`edit.session`) are the reference examples; the `instrumentation` skill walks
through them and the per-runtime APIs.

## Correlate across hops

- Propagate W3C trace context on every hop. Inbound HTTP adopts `traceparent`
  through `macro_tower_layers`; outbound Rust HTTP calls `inject_trace_headers`;
  Kafka publishes carry trace headers via `kafka_util`; agent and ACP messages
  use `genai_telemetry::propagation`. A new transport (queue message, websocket
  frame, worker call) needs inject on send and extract on receive. If a hop
  can't carry context, record the upstream trace id as a span field.
- Web and Cloudflare Workers use the `@macro-inc/observability` `Telemetry`
  facade (`Telemetry.span`, `Telemetry.clientSpan`); don't import OpenTelemetry
  directly and don't add a second telemetry path.

## Spans at boundaries

- Span the places a trace would otherwise go dark: queue and Kafka consumers,
  cross-service client calls, background jobs, and multi-step business
  operations. Don't span trivial helpers; HTTP handlers already get spans from
  `macro_tower_layers`.
- Name spans for the operation (`calendar.sync_account`), not the function.
- Record the IDs you will search by (entity, user, team, session, document) and
  sizes/counts as fields. Skip bulky or sensitive arguments; never record
  prompts, message content, tokens, secrets, or personal data (email, username,
  IP); use opaque ids.
- Async work that outlives the request (spawned tasks, queued jobs) links to or
  parents on the span that started it, so the flow stays one trace.

## Timing

- Separate the phases a reader would ask about: queueing vs. execution, network
  vs. processing, each external call. Long operations get child spans per phase,
  not one opaque span.
- Record outcome on the span (error status, retry count, cache hit/miss), so
  slow and failed paths can be filtered without logs.

## Logs

- Logs are events inside spans with structured fields, not a parallel narrative:
  one `warn!` with fields beats several formatted `debug!`s. Rust specifics are
  CS-22 in [`rust/code.md`](rust/code.md); GenAI spans follow CS-55.

Check: run the changed flow locally and find its trace in Tempo (see the
`live-debug` skill): it is one connected trace across services, phases show their
durations, and the span is findable by the entity ID.
