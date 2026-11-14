# xtask_local_telemetry

## What it is

Local build timings, on by default, for `just run_local`, `just stack` and
`cargo x build-services`: each run, step, build and service health wait becomes
one Loki line (`service_name="local-telemetry"`) and a Tempo span,
mirroring CI's `ci-telemetry` events. `xtask_local` decides what to record; this
crate buffers and sends it. With `services = true` in the settings it also
decides whether the local stacks' own telemetry is forwarded, under which
machine name, and writes the forwarder's token file; `xtask_local`'s
`grafana_forwarder.rs` runs the containers.

## Start here

- `src/lib.rs`: `Recorder` (start, record, finish) and the buffer line format.
- `src/config.rs`: the settings file, the `MACRO_LOCAL_TELEMETRY`/`CI` switch,
  and the Doppler provisioning command.
- `src/provision.rs`: writing the settings file from Doppler, backoff, the hint.
- `src/sender.rs`: the background thread, retries, and left-behind files.
- `src/forwarding.rs`: `services = true`, the machine name, the private token file.
- `src/otlp.rs`: the OTLP JSON, copied from CI's `ci_telemetry_collect.ts`.

## Scope

- Owns: the settings file and its provisioning, the opt-out, the buffer, OTLP
  encoding, delivery, and whether services' telemetry is forwarded.
- Not here: which events a run emits and their fields →
  `xtask_local/src/local/telemetry.rs`; the forwarder and lgtm containers →
  `xtask_local/src/local/grafana_forwarder.rs`, `docker/grafana-forwarder/`.
  Panels → `infra/stacks/observability/nixos/local-report.json` and
  `local-dashboard.nix`.

## Checks

- `cargo test -p xtask_local_telemetry`

## Gotchas

- Off (opted out, or provisioning failed within the hour) means
  `Recorder::start` returns `None` before creating anything; keep every new path
  behind it, so opted-out runs make no file, no request and no Doppler call.
- Never block the caller on the network or Doppler: `record` only appends to the
  file, provisioning runs on the sender thread, and `finish` waits at most the
  bound it is given. Nothing on the sender thread prints.
- Provisioning never replaces a settings file the user wrote: it links the new
  file into place only if none exists, and replaces only a `provisioned = true`
  file that still holds the exact config whose token got a 401/403, once per
  process.
- Short commands exit before Doppler answers: the token command writes into a
  hidden 0600 `.local-telemetry.toml.<id>.token` beside the settings, which
  the next run reads. It is killed after 15 s; a stale empty one counts as a
  failed fetch (an hour of backoff).
- A buffer file is deleted only after a 2xx or a 4xx other than 401/403; a
  timeout, a 5xx or a rejected token keeps it for the next run. Bodies and
  times must stay identical across resends (Loki dedupes on them), and old
  lines are clamped to 30 minutes as in CI.
- The token is only in Doppler `observability/lcl`, the settings file (0600),
  the `Authorization` header and, with `services = true`, the forwarder's token
  file (0600 in a 0700 directory, mounted read-only): never in env, the `local`
  Doppler project, a compose file, errors, or logs. Errors carry error
  classes, never response bodies or parser source lines.
- Fields are structured metadata, not labels: only `service_name` and
  `deployment_environment` index the stream. Group metadata quantiles with an
  explicit `by (...)` (see `infra/stacks/observability/README.md`).

## Related

- Docs: `docs/development/running-locally.md` (what is sent, opting out),
  `infra/stacks/observability/README.md` (fields and queries)
