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

- `src/domain/lifecycle.rs` + `lifecycle/test.rs`: states, events, effects, invariants; `lifecycle/billing.rs` holds the billing and charging transitions.
- `src/domain/service.rs`: the team-facing `ComputerService` (purchase, offers, purchase_offers, list, power, retry, cancel, release). `purchase_offers` is the buy dialog's listing: one `Billing::purchase_terms` call for every size (today's prorated charge, renewal date, card), never made on the purchase path.
- `src/domain/enrollment.rs`: the first-boot contract with `macrod enroll`.
- `src/domain/image.rs`: versioned images and the root/data disk split.
- `src/domain/size.rs`: `SIZE_SPECS`, every tier's vCPUs, memory, root and
  `/home` disks and units written out; tests pin them to the fleet's derivations.
- `src/domain/operator.rs`: the control plane (fleet effects, timers, reconcile,
  macrod presence); wired in `services/agent_harness_service/src/computers.rs`.
- `src/inbound/axum_router.rs`: `/team/computers*`, mounted by
  authentication_service.
- `src/outbound/pg/agents.rs`: `ComputerAgents`, also alone as
  `PgComputerAgents`, which implements harnesses' `ComputerTeamAgents` so
  harness listings mark an agent teammate's computer.
- `src/outbound/`: Postgres repo, `FirecrackerFleet` (the Firecracker host
  agent, `crates/firecracker_host_api`), dev-only `DockerFleet`,
  `ConfiguredFleet` (one host's fleet) and `HostFleets` (the `ports::Fleets`
  the operator drives: a `FirecrackerFleet` per host row with an endpoint,
  or the local Docker home host).
- `src/domain/operator/`: `hosts.rs` (home registration, per-host fleets,
  reconcile) and `effects.rs` (the effect pass: each host's effects in lease
  order, `max_concurrent_starts` at a time).
- `src/domain/overcommit.rs` (+ `overcommit/`): pure per-host capacity,
  admission (allocation + fresh memory report + pending starts), relief
  (idlest guests to hibernate) and guest idleness. `src/domain/operator/relief.rs`
  runs it: the overcommit pass, hibernation and wakes. Storage:
  `src/outbound/pg/admission.rs` and `pg/hosts.rs`; ports:
  `src/domain/ports/overcommit.rs`. Settings and live tuning:
  [overcommit runbook](../../docs/runbooks/computer-overcommit.md).
- `src/domain/usage.rs`: the CPU and memory graphs in Settings. The
  overcommit pass keeps one reading per running computer per minute
  (`operator/relief.rs` `record_usage`, from the same host answer; it never
  fails the pass) in `hosted_runtime_usage_sample` (`outbound/pg/usage.rs`,
  port `ports/usage.rs`), pruned after 25 hours; `history` turns readings
  into the 96 15-minute points `GET /team/computers/usage` answers. Readings
  hold the cgroup's CPU counter, so CPU is its growth between two readings
  of one run (absent on a run's first reading; memory is on every reading).
  Memory is what only the computer holds (`anon` + swap), not what it shares
  with its image; a host agent that reports no swap gives no reading.
- `src/domain/moves.rs` + `src/domain/operator/moves.rs`: moving a computer to
  another host (seed rounds while it runs, cutover, flip, verify, rollback),
  advanced by the move pass. The agents copy the ZFS dataset between
  themselves; `flip` (`outbound/pg/moves.rs`) points `host_id` at the new host
  and applies `Event::Moved` in one transaction. While a cutover or rollback
  holds a computer, reconcile skips it and its fleet effects wait; an open
  move counts the computer on both hosts in the held-capacity CTEs.

## Scope

- Owns: computer rows, hosts, outbox, timers, lifecycle, size catalog.
- Not here: harness rows and pairing → `crates/harnesses`; the subscription's
  seat logic → `crates/teams`; macrod enrollment → `crates/coding_agent_worker`.
- Sizes are this crate's own; do not reuse `agent_harness`'s `SandboxSize`.

## Boundaries

- Depends on: `firecracker_host_api`, `pinned_tls` (fleets),
  `feature_flags` (rollout),
  `entity_access`, `macro_authorization`; with `outbound`, `harnesses` (its
  repository for Claude logins, never its tables).
- Used by: authentication_service (routes, billing worker), agent_harness_service
  (operator, harnessd), `coding_agent_worker` (enrollment).

## Checks

- `cargo test -p hosted_runtimes` (`SQLX_OFFLINE` unset for DB tests).
- `cargo run -p hosted_runtimes --example firecracker_fleet_smoke -- …` drives
  create → exec → power → destroy against a Firecracker host agent.
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
- The operator leases fleet effects and timers only for the hosts it drives
  (`ports::HostScope::Only`: the local home host, or every host row with a
  connection); billing passes `HostScope::Every`. Purchases land only on
  admitting hosts (`hosted_runtime_host.admitting`).
- First start: until setup completes, and for an agent computer until its
  agent reports online (`ComputerState::awaiting_agent`, cleared by
  `Event::AgentOnline` from team_agents, which also stamps
  `setup_completed_at`, so an agent computer never offers the person's guided
  setup; each macrod connection meanwhile
  queues `Effect::DeliverAgent`, which hands the agent over the runtime bus to
  the replica holding macrod's socket; `TimerKind::AgentStartDue` gives it
  `AGENT_START_DEADLINE` after macrod connects, then fails it with
  `Failure::AgentNotStarted`; a macrod that declared no `apply-agent`
  capability when it dialed applies `Event::MacrodConnectedWithoutAgentHandOff`
  instead, which fails it at once with `Failure::AgentUnsupported` and pages).
  An `AgentOnline` after the deadline recovers the computer (`Running`,
  failure cleared); see the recovery rules in the architecture doc.
  A give-up during the first start counts in `first_start_failures`, except
  `Failure::HostLost` (a host outage is not the computer's failure); the first
  leaves the computer for a team retry
  (no new charge), the second (`MAX_FIRST_START_FAILURES`) releases it
  (`EndsAt{now}`, Destroy), queues `Effect::RefundPurchase` (billing worker:
  a credit note on the purchase's invoice under `computer-refund:{id}`,
  recorded as `ComputerState::refund`, then the item removed without
  proration) and `Effect::UndoAgentInvite` (agents worker), and notifies
  `SetupOutcome::Released`.
- The agents worker (`ComputerService::run_agent_effects`, run by
  authentication_service with team_agents as `ports::AgentInvites`, only with
  `COMPUTERS_AGENT_EFFECTS=true`) retries
  with `BILLING_BACKOFF` and gives up after `MAX_AGENT_ATTEMPTS` with the error
  log `agent invite undo abandoned`; a refund that exhausts its attempts logs
  `computer purchase refund abandoned`, and one that finds no paid purchase for
  a billed computer logs `computer purchase refund found no paid purchase`.
  Alerts key on all three
  (`infra/stacks/monitoring/monitors/computers.ts`).
- A charged purchase converts before it charges: the request holds the
  computer's billing guard and runs the charge while the fleet creates the
  guest (`Billing::Charging`, `Charger::Request`). Anything that acts on
  billing while charging must handle `Charging`: billing requests are
  `Rejected::PaymentPending`, releases queue `Effect::SettleCharge`, and
  `TimerKind::ChargeUnsettled` (`CHARGE_TAKEOVER`) hands a charge the request
  never answered to the billing worker (`Effect::Charge`, never abandoned).
  A billing effect turned away by `BillingError::ChangeInFlight` (another
  change to the subscription still settling, e.g. a release's item removal)
  is deferred `CHANGE_IN_FLIGHT_RETRY` (`ComputerRepo::defer_effect`), not
  backed off, and spends no attempt.
- Each host's capacity comes from its own row (NOT NULL settings, measured
  defaults); registration only reports hardware (`HostRegistration`: vCPUs and
  memory), and recomputes the row's units from its settings.
- Admission fails closed: a host without a fresh memory report (30 s by
  default; the overcommit pass reports every 10 s) admits nothing. A
  hibernated computer is `Running` to the lifecycle; only
  `hosted_runtime.hibernated_at` and the fleet's power state say it sleeps.
  Anything that execs into guests must skip hibernated ones
  (`awake_computers` does).
- Two kinds of "idle", two owners: relief's idle (hibernation) is this
  crate's (`overcommit::ActivityTracker`: under 10 % of a vCPU between passes
  for `minimum_idle_seconds`, and no agent session with a turn running or
  queued); the zram squeeze's idle is the host agent's (guest CPU quiet for
  30 minutes, `services/firecracker_host`). Neither reads the other's.
- Keep `#![deny(missing_docs)]` and document every public item tersely (CS-54).

## Related

- Docs: [Macro computers](../../docs/architecture/macro-computers.md) ·
  [setup trace runbook](../../docs/runbooks/computer-setup-traces.md) ·
  [overcommit runbook](../../docs/runbooks/computer-overcommit.md) ·
  Skill: `cloud-storage-hexagonal-architecture`
