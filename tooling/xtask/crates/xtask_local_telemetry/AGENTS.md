# xtask_local_telemetry

## What it is

Opt-in timings for `just run_local`: each run, step, build and service health
wait becomes one Loki line (`service_name="local-telemetry"`) and a Tempo span,
mirroring CI's `ci-telemetry` events. `xtask_local` decides what to record; this
crate buffers and sends it.

## Start here

- `src/lib.rs`: `Recorder` (start, record, finish) and the buffer line format.
- `src/sender.rs`: the background thread, retries, and left-behind files.
- `src/otlp.rs`: the OTLP JSON, copied from CI's `ci_telemetry_collect.ts`.

## Scope

- Owns: the opt-in file, the buffer, OTLP encoding, delivery.
- Not here: which events a run emits and their fields →
  `xtask_local/src/local/telemetry.rs`. Panels → `infra/stacks/observability/nixos/local-report.json`.

## Checks

- `cargo test -p xtask_local_telemetry`

## Gotchas

- Off means `Recorder::start` returns `None` before creating anything; keep
  every new path behind it, so opted-out runs make no file and no request.
- Never block the caller on the network: `record` only appends to the file, and
  `finish` waits at most the bound it is given.
- A buffer file is deleted only after a 2xx or a 4xx; a timeout or a 5xx keeps
  it for the next run. Bodies and times must stay identical across resends
  (Loki dedupes on them), and old lines are clamped to 30 minutes as in CI.
- The token is only in the opt-in file and the `Authorization` header: errors
  carry error classes, never response bodies or parser source lines.
- Fields are structured metadata, not labels: only `service_name` and
  `deployment_environment` index the stream. Group metadata quantiles with an
  explicit `by (...)` (see `infra/stacks/observability/README.md`).

## Related

- Docs: `docs/development/running-locally.md` (enabling it),
  `infra/stacks/observability/README.md` (fields and queries)
