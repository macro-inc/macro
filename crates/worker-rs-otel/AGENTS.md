# worker-rs-otel

## What it is

Shared infrastructure for observability — OpenTelemetry tracing support for
Cloudflare Workers built with `worker-rs` (used by `services/sync-service`).
Hand-rolled OTLP transport/buffer/flush because wasm Workers can't use the
regular `opentelemetry-otlp` exporter.

## Start here

- `src/layer.rs`: the `tracing_subscriber::Layer` that closes spans into the
  buffer.
- `src/exporter.rs`: thread-local span/log buffers and the flush-to-OTLP path,
  gated by the `OTEL_EXPORTER_OTLP_ENDPOINT` and `ENVIRONMENT` vars.
- `src/trace_context.rs`: W3C traceparent parsing/propagation for incoming
  requests.
- `src/proto.rs` / `src/model.rs`: real `opentelemetry-proto` wire types for
  serialization — not a hand-rolled schema.

## Scope

- Owns: span/log buffering and OTLP export for one Cloudflare Worker
  invocation, plus traceparent propagation.
- Not here: Rust-service or browser OTel — those use the regular
  `opentelemetry` SDK or `packages/observability`.

## Boundaries

- Depends on: `opentelemetry`, `opentelemetry-proto`, `opentelemetry_sdk`,
  `worker` (Cloudflare Workers runtime), `getrandom` (`wasm_js` feature).
- Used by: `services/sync-service`.

## Checks

- `cargo test -p worker-rs-otel` (`SQLX_OFFLINE` unset).

## Gotchas

- `getrandom`'s `wasm_js` feature must stay enabled — wasm Workers have no OS
  randomness source otherwise.
- Buffers are thread-local and capped (`MAX_BUFFERED_SPANS`/`MAX_BUFFERED_LOGS`
  = 512); a Worker invocation that exceeds this silently drops the overflow.

## Related

- Rules: `.agents/rules/observability.md`
