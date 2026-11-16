# Agent harness runtime alerts

Runbook for the monitors in
[`monitors/harness-runtimes.ts`](../../infra/stacks/monitoring/monitors/harness-runtimes.ts).
Their alerts link the **Agent harness runtimes** dashboard. None of them page.

A runtime (macrod or another harness daemon) dials agent-harness-service and
lists the ACP sessions it still serves. The replica it reached reattaches them
in `reattach_live_sessions` (`crates/agent_harness/src/domain/service/reattach.rs`),
under one `agent.runtime.reattach` span per dial. Sessions with no activity for
seven days and nothing waiting on them are dormant: the dial only counts them.
A dial restores at most `MAX_EAGER_PER_DIAL` (50) sessions now, most recently
active first; the rest bind on their next prompt or delivery. Sessions with a
turn unfinished, a command in flight or a queued prompt are always restored,
even past the cap.

| What | Search |
| --- | --- |
| Dials | Spans: `service:agent-harness-service resource_name:agent.runtime.reattach`, by `@harness` |
| Sessions per dial | `@agent.runtime.reattach_sessions` (listed, not dormant); `.reattach_eager`, `.reattach_lazy`, `.reattach_capped` (recent, left lazy by the cap), `.reattach_required` (restored past any cap), `.reattach_dormant`, `.reattach_skipped`, `.reattach_failures` |
| Connects and disconnects | Logs: `@telemetry_event:(harness_runtime_connected OR harness_runtime_disconnected)` `@harness:<id>` |
| Starvation | Logs: `service:agent-harness-service "tokio runtime starvation detected"`, by `host`; `@delay_ms` |
| Task memory | Metrics: `ecs.fargate.mem.rss` / `ecs.fargate.mem.limit`, `short_image:agent-harness-service-prod,container_name:service`, by `task_arn` |

## Reattaching in a loop

One runtime dialed more than 15 times in 15 minutes. A healthy runtime dials
once per connection, so it is reconnecting over and over and every dial
reattaches its sessions again.

- Read its connect and disconnect logs: the disconnect reason, and whether the
  dials land on different replicas.
- A replica that drops it right after reattach is often starving under the
  reattach itself; check **Tokio runtime starving** below.
- Lever: ask the runtime's owner to stop the daemon until the loop is fixed.

## Reattaching too many sessions

One runtime listed more than 500 sessions to reattach in 15 minutes. Loading
that many at once starves the replica it dialed and stalls every other
session there.

- Compare `reattach_eager` with `reattach_lazy`, `reattach_dormant` and
  `reattach_skipped` on its spans: idle sessions should bind lazily and
  week-old ones should be dormant, so a high eager count means many of them
  look active. A runtime that keeps hitting the cap shows a non-zero
  `reattach_capped`; `reattach_required` above 50 means that many sessions
  had work waiting and were restored anyway (the replica also logs "a dial
  restores more sessions with work in flight than its eager cap").
- A high `reattach_failures` count means attaches are retrying; check the
  harness errors on that replica.

## Tokio runtime starving

agent-harness-service logged more than 1,000 starvation warnings in
15 minutes: its runtime ticks ran late, so requests, websockets and leases
stall.

- Group the warnings by `host` to find the replica, and look for a reattach
  storm or a slow blocking call on it at the same time.
- `@delay_ms` above 1,000 means ticks ran over a second late.
- `@cpu_wait_ms`, the longest any one thread waited for a CPU, near or above
  `@delay_ms` means the replica's threads could not get a CPU: the task spent
  its CPU quota for the 100 ms period, or every CPU was busy (its own work,
  its sidecars or other processes). With that wait, one task logging the
  same `@delay_ms` over and over points at its quota. Moving work off the
  runtime does not help there; less CPU or a larger task does.
- `@cpu_wait_ms` well below `@delay_ms` means a task held a runtime thread,
  computing or blocked. `@cpu_run_ms` (CPU all threads used in the interval,
  `@actual_ms` long) tells which, against the replica's usual CPU use.

## Task memory near its limit

One agent-harness-service task's resident memory passed 75% of its limit.
ECS kills the task at 100%, and every session it serves drops and resumes on
the other replica.

- Compare the per-process gauges (`ahs.harness.workers`,
  `ahs.agent_session.active`, `ahs.inmem.*`, from
  `services/agent_harness_service/src/runtime_gauges.rs`) on that task with
  its memory: one that climbs with it is the holder. Flat gauges under a
  climbing memory point at the allocator.
- Lever: replace the task (a deploy, or stopping it so ECS starts a new one).
  Sessions resume from Postgres on their next prompt.
