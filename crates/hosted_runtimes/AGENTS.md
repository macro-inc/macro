# hosted_runtimes

## What it is

Macro computers: hosted VMs a team buys, each running macrod so it shows up
in Settings → Runtimes like a paired machine. This crate owns the computer
lifecycle, capacity, purchase/billing orchestration and the fleet ports.

## How it works

`domain::lifecycle::transition(state, event, context)` is pure; `ComputerRepo::apply`
locks the row, runs it and stores state, outbox effects and timers in one
transaction. Workers run the effects: billing in authentication_service, fleet
effects and timers in agent_harness_service. The full system (rollout,
configuration, billing, capacity, enrollment, setup tracing) is in
[docs/architecture/macro-computers.md](../../docs/architecture/macro-computers.md);
read it before changing behaviour.

## Start here

- `src/domain/lifecycle.rs` + `lifecycle/test.rs`: states, events, effects, invariants.
- `src/domain/service.rs`: the team-facing `ComputerService` (purchase, offers, list, power, retry, cancel, release).
- `src/domain/enrollment.rs`: the first-boot contract with `macrod enroll`.
- `src/domain/image.rs`: versioned images and the root/data disk split.
- `src/domain/operator.rs`: the control plane (fleet effects, timers, reconcile,
  macrod presence); wired in `services/agent_harness_service/src/computers.rs`.
- `src/inbound/axum_router.rs`: `/team/computers*`, mounted by
  authentication_service.
- `src/outbound/pg/agents.rs`: `ComputerAgents`, also alone as
  `PgComputerAgents`, which implements harnesses' `ComputerTeamAgents` so
  harness listings mark an agent teammate's computer.
- `src/outbound/`: Postgres repo, `IncusFleet`, dev-only `DockerFleet`, and
  `ConfiguredFleet` (explicit `COMPUTERS_FLEET`, never a fallback).

## Scope

- Owns: computer rows, hosts, outbox, timers, lifecycle, size catalog.
- Not here: harness rows and pairing → `crates/harnesses`; the subscription's
  seat logic → `crates/teams`; macrod enrollment → `crates/coding_agent_worker`.
- Sizes are this crate's own; do not reuse `agent_harness`'s `SandboxSize`.

## Boundaries

- Depends on: `incus_client` (fleet), `feature_flags` (rollout),
  `entity_access`, `macro_authorization`; with `outbound`, `harnesses` (its
  repository for Claude logins, never its tables).
- Used by: authentication_service (routes, billing worker), agent_harness_service
  (operator, harnessd), `coding_agent_worker` (enrollment).

## Checks

- `cargo test -p hosted_runtimes` (`SQLX_OFFLINE` unset for DB tests).
- `cargo run -p hosted_runtimes --example incus_fleet_smoke -- …` drives
  create → stop → start → destroy against a dev Incus host.
- With `macro-box:latest` loaded, run the Docker isolation regression with
  `cargo test -p hosted_runtimes listing_cannot_expose_another_fleets_containers_to_reconciliation -- --ignored`.
- With `busybox:latest` pulled, run the Docker exec regression with
  `cargo test -p hosted_runtimes exec_streams_stdin_to_stdout_and_reports_the_exit_code -- --ignored`.

## Gotchas

- Timers are never cancelled: `transition` ignores events that no longer apply,
  so a new state must guard every timer event it can receive.
- Each computer's effects run strictly in outbox order (`lease_effects` leases
  only a computer's oldest effect per worker).
- A pool timeout is `ports::StorageUnavailable`
  (`ComputerError::is_storage_unavailable`): passes skip the tick and effects
  keep their attempts. Never count it as an effect failure.
- A billing removal keeps one idempotency key across retries; see
  `removal_key` and the subscription guard in `crates/teams/AGENTS.md`.
- `PageOperator` is the log event `computer needs an operator` (error level);
  alerts key on it.
- `NotifySetup` tells the buyer how first setup ended through the
  `ports::SetupNotices` port (adapter: team_agents
  `outbound/setup_notices.rs`): `Ready` on the first macrod connection,
  `Failed` on each give-up before it (keyed by `failed_at`, so a retried
  attempt notifies again). It never fails the computer when it cannot be sent.
  `SetupNotice.agent` names the agent teammate an agent computer runs
  (`ComputerAgents::agent_of`), so the adapter can tell its inviter by name;
  for such a computer the adapter skips `Ready`, which the agent's own
  online report sends instead.
- The operator leases fleet effects and timers only for its own host
  (`ports::HostScope::Only`); billing passes `HostScope::Every`. Purchases
  land only on admitting hosts (`hosted_runtime_host.admitting`).
- First start: until setup completes, and for an agent computer until its
  agent reports online (`ComputerState::awaiting_agent`, cleared by
  `Event::AgentOnline` from team_agents; each macrod connection meanwhile
  queues `Effect::DeliverAgent`, which hands the agent over the runtime bus to
  the replica holding macrod's socket; `TimerKind::AgentStartDue` gives it
  `AGENT_START_DEADLINE` after macrod connects, then fails it with
  `Failure::AgentNotStarted`). A give-up during the first start counts in
  `first_start_failures`; the first leaves the computer for a team retry
  (no new charge), the second (`MAX_FIRST_START_FAILURES`) releases it
  (`EndsAt{now}`, Destroy), queues `Effect::RefundPurchase` (billing worker:
  a credit note on the purchase's invoice under `computer-refund:{id}`,
  recorded as `ComputerState::refund`, then the item removed without
  proration) and `Effect::UndoAgentInvite` (agents worker), and notifies
  `SetupOutcome::Released`.
- The agents worker (`ComputerService::run_agent_effects`, run by
  authentication_service with team_agents as `ports::AgentInvites`) retries
  with `BILLING_BACKOFF` and gives up after `MAX_AGENT_ATTEMPTS` with the error
  log `agent invite undo abandoned`; a refund that exhausts its attempts logs
  `computer purchase refund abandoned`. Alerts key on both
  (`infra/stacks/monitoring/monitors/computers.ts`).
- A charged purchase converts before it charges: the request holds the
  computer's billing guard and runs the charge while the fleet creates the
  guest (`Billing::Charging`, `Charger::Request`). Anything that acts on
  billing while charging must handle `Charging`: billing requests are
  `Rejected::PaymentPending`, releases queue `Effect::SettleCharge`, and
  `TimerKind::ChargeUnsettled` (`CHARGE_TAKEOVER`) hands a charge the request
  never answered to the billing worker (`Effect::Charge`, never abandoned).
- Keep `#![deny(missing_docs)]` and document every public item tersely (CS-54).

## Related

- Docs: [Macro computers](../../docs/architecture/macro-computers.md) ·
  [setup trace runbook](../../docs/runbooks/computer-setup-traces.md) ·
  Skill: `cloud-storage-hexagonal-architecture`
