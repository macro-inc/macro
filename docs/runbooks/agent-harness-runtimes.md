# Agent harness runtime alerts

Runbook for the monitors in
[`monitors/harness-runtimes.ts`](../../infra/stacks/monitoring/monitors/harness-runtimes.ts).
Their alerts link the **Agent harness runtimes** dashboard. None of them page.

A runtime (macrod or another harness daemon) dials agent-harness-service and
lists the ACP sessions it still serves. The replica it reached reattaches them
in `reattach_live_sessions` (`crates/agent_harness/src/domain/service.rs`),
under one `agent.runtime.reattach` span per dial:

| What | Search |
| --- | --- |
| Dials | Spans: `service:agent-harness-service resource_name:agent.runtime.reattach`, by `@harness` |
| Sessions per dial | `@agent.runtime.reattach_sessions`; `.reattach_eager`, `.reattach_lazy`, `.reattach_skipped`, `.reattach_failures` |
| Connects and disconnects | Logs: `@telemetry_event:(harness_runtime_connected OR harness_runtime_disconnected)` `@harness:<id>` |
| Starvation | Logs: `service:agent-harness-service "tokio runtime starvation detected"`, by `host`; `@delay_ms` |

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

- Compare `reattach_eager` with `reattach_lazy` and `reattach_skipped` on its
  spans: idle sessions should bind lazily, so a high eager count means many of
  them look active.
- A high `reattach_failures` count means attaches are retrying; check the
  harness errors on that replica.

## Tokio runtime starving

agent-harness-service logged more than 1,000 starvation warnings in
15 minutes: its runtime threads are blocked, so requests, websockets and
leases stall.

- Group the warnings by `host` to find the replica, and look for a reattach
  storm or a slow blocking call on it at the same time.
- `@delay_ms` above 1,000 means ticks ran over a second late.
