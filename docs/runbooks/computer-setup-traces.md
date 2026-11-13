# Macro computer setup traces

Use this to find where the time goes between Buy computer and the computer
being Ready.

## What one trace contains

The purchase request is the root. Every later step joins it while first setup
runs ([Macro computers: Observability](../architecture/macro-computers.md#observability)):

| Span | Service | Meaning |
| --- | --- | --- |
| `purchase` → `reserve` | authentication_service | Purchase; `reserve` holds the persisted parent. |
| `computer.setup.payment` | authentication_service | Reservation until conversion; the charge no longer delays it. |
| `computer.billing.effect` | authentication_service | The purchase's charge, run beside creation (and its retries). |
| `computer.setup.create` | agent_harness_service | Confirmation until the guest boots: outbox wait, fleet create, capacity wait (`capacity_waited`). |
| `computer.fleet.work` → `incus_fleet.create` / `docker_fleet.create` → `computer.enrollment.issue` | agent_harness_service | The fleet create effect itself. |
| `computer.setup.boot` | agent_harness_service | Guest boot until macrod first connects (boot, `macrod enroll`, harness claim, connect). |
| `claim_pairing` | document_storage_service | macrod claiming its harness (its request carries the setup `traceparent`). |
| `computer.macrod.connected` | agent_harness_service | The first connection being recorded. |
| `computer.setup` | agent_harness_service | Total, reservation until macrod first connected. |
| `run_enroll`, `macrod.enroll.claim` | macrod | Guest-side detail, only when the guest has `OTEL_EXPORTER_OTLP_ENDPOINT`. |

The control-plane wait spans are exported with their recorded start and end
times when the next milestone arrives, so a still-running wait is not visible
yet: look at the last finished one and the computer's current phase.

## Find a setup trace

In Tempo (local Grafana at http://localhost:3001, datasource `tempo`):

```traceql
{ name = "computer.setup" && span.computer_id = "<computer uuid>" }
```

Slow setups across computers:

```traceql
{ name = "computer.setup" && duration > 5m }
```

Open the trace; the wait spans show which phase took the time. To see setups
still in progress, search any phase: `{ name =~ "computer.setup.*" &&
span.computer_id = "<computer uuid>" }`.

In Datadog, use `operation_name:computer.setup @computer_id:<computer uuid>`,
and the `computer.setup.phase.duration` / `computer.setup.duration`
histograms (by `phase`) for distributions.

## Local collector

`just run_local` starts the shared LGTM collector (`macro-lgtm-1`) and attaches
it to the instance's `services` network as `otel-collector`. A stack started
without it logs `BatchSpanProcessor.ExportError` DNS errors. Attach the running
collector to that stack without restarting it:

```sh
docker network connect --alias otel-collector macro-<instance>_services macro-lgtm-1
```

If no collector runs yet, start it first with
`docker compose --project-directory . -f docker/docker-compose.yml --profile lgtm up -d lgtm`
from the repository root.
