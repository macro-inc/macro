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
- A purchase provisions at once and charges in the billing worker
  (`Effect::Charge`, `Billing::Charging`); the charge is never abandoned (its
  last attempt settles), a refusal releases the computer, and a team has one
  unpaid computer at a time (`ComputerError::UnpaidComputer`).
- A billing removal keeps one idempotency key across retries; see
  `removal_key` and the subscription guard in `crates/teams/AGENTS.md`.
- `PageOperator` is the log event `computer needs an operator` (error level);
  alerts key on it.
- `NotifySetup` tells the buyer how first setup ended through the
  `ports::SetupNotices` port (adapter: agent_harness_service
  `computers/setup_notice.rs`): `Ready` on the first macrod connection,
  `Failed` on each give-up before it (keyed by `failed_at`, so a retried
  attempt notifies again). It never fails the computer when it cannot be sent.
- Keep `#![deny(missing_docs)]` and document every public item tersely (CS-54).

## Related

- Docs: [Macro computers](../../docs/architecture/macro-computers.md) ·
  [setup trace runbook](../../docs/runbooks/computer-setup-traces.md) ·
  Skill: `cloud-storage-hexagonal-architecture`
