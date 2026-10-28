# macro_entrypoint

## What it is

Belongs to shared infrastructure: standardized binary initialization —
tracing/logging/OTel setup and graceful shutdown — used as the first thing
nearly every Rust service's `main.rs` calls.

## Start here

- `src/lib.rs`: `MacroEntrypoint::init` — builds the tracing subscriber stack
  per `Environment` (local / develop / production), returning
  `InitializedEntrypoint` as proof of initialization; call `.shutdown()`
  before exit to flush OTel. Serverless handlers retain it and await
  `.force_flush()` after invocation spans close, without shutting down warm
  providers. The caller must bound flush time and preserve its operation result.
- `src/datadog_fmt.rs`: JSON log format injecting `dd.trace_id`/`dd.span_id`
  for prod/develop trace-log correlation.
- `src/grafana.rs`: a second, best-effort span exporter that mirrors spans to
  Grafana in `develop` without affecting the primary (Datadog) exporter.
- `src/shutdown.rs`: `shutdown_signal` — the standard graceful-shutdown
  future every service awaits on.

## Scope

- Owns: the tracing/logging/OTel subscriber setup and graceful shutdown
  signal shared by every service's composition root.
- Not here: per-service span content or business instrumentation — this
  crate only wires the pipeline.

## Boundaries

- Depends on: `macro_env`, `macro_env_var`, `rootcause`/`rootcause-tracing`.
- Used by: nearly every service in `services/` plus a few crates with their
  own binaries (`documents`, `entity_access`, `memory`, `opensearch_client`,
  `task_dedup`, `teams`).

## Checks

- `cargo test -p macro_entrypoint` (`SQLX_OFFLINE` unset).

## Gotchas

- `RUST_LOG` is read through `macro_env_var`'s `APP_SECRETS_JSON`-first
  convention, not `EnvFilter::from_default_env` directly — a bare
  `std::env::var("RUST_LOG")` fallback would silently diverge from this.
- An absent/empty `RUST_LOG` still gets an INFO floor (`rust_log_builder`);
  this is intentional so a misconfigured service logs quietly rather than
  not at all while still emitting spans.
- Local OTLP export is opt-in (`OTEL_EXPORTER_OTLP_ENDPOINT` must be set);
  xtask sets it only for trace-enabled local runs.
- Prod/develop export logs as JSON on stdout for Datadog, not via OTLP — only
  spans go through OTLP there.

## Related

- Skill: `new-service` · Docs: `docs/guides/new-service.md`
