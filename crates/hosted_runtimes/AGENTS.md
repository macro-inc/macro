# hosted_runtimes

## What it is

Macro computers: hosted VMs a team buys, each running macrod so it shows up
in Settings → Runtimes like a paired machine. This crate owns the computer
lifecycle, capacity, purchase/billing orchestration and the fleet ports.

## How it works

- `domain::lifecycle::transition(state, event, context) -> (state, effects)` is
  pure. `ComputerRepo::apply` locks the row (and host), runs it, and stores the
  state, outbox effects and timers in one transaction.
- Effects run in workers keyed by outbox id: `Billing` effects where Stripe lives
  (authentication_service), `Fleet` effects and timers in agent_harness_service.
- Capacity is in units (`domain::size`): Standard 1, Large 2, XL 4. Purchase
  reserves sold units on a host; waking checks awake units (`Context::host_has_room`).

## Start here

- `src/domain/lifecycle.rs` + `lifecycle/test.rs`: states, events, effects, invariants.
- `src/domain/service.rs`: the team-facing `ComputerService` (purchase, quote, status, power, cancel, release).
- `src/domain/enrollment.rs`: the first-boot contract with `macrod enroll`.

## Contracts (PR B, agent brains, builds on these — keep them stable)

- **Purchase**: `ComputerService::purchase(PurchaseRequest { team_id, created_by, size, name, persona, extra_items })`
  → `computer_id`. One Stripe subscription update adds the computer's item plus
  every `extra_items` entry (`SubscriptionItem { price_id, quantity }`, quantity
  added to the item's current quantity), invoiced at once with proration. In-process
  in authentication_service, and on the internal route `POST /internal/computers`.
- **Quote**: `ComputerService::quote(team_id, size)` → `Quote { price_id, amount, currency, interval }`
  at the team subscription's interval.
- **Status**: `ComputerService::status(team_id, computer_id)` / `list(team_id)` →
  `ComputerStatus` with `setup: Option<SetupProgress>` (Paying → Creating → Booting →
  Connecting → Ready) until macrod first connects. Readable by any team member.
- **Persona**: `Persona { name, os_user, extra_service: { unit_name, exec, env }, config }`.
  `macrod enroll` creates `os_user`, writes `config` to `/etc/macro/personas/<os_user>.env`
  (the unit's `EnvironmentFile`), and installs + starts `/etc/systemd/system/<unit_name>.service`
  as that user. Validated by `service::validate_persona`.
- **Gateway**: computers call Claude via `ANTHROPIC_BASE_URL=<agent harness service>/anthropic`
  with a per-session token; see `services/agent_harness_service/AGENTS.md`.

## Scope

- Owns: computer rows, hosts, outbox, timers, waitlist, lifecycle, size catalog.
- Not here: harness rows and pairing → `crates/harnesses`; the subscription's
  seat logic → `crates/teams`; macrod enrollment → `crates/coding_agent_worker`.
- Sizes are this crate's own; do not reuse `agent_harness`'s `SandboxSize`.

## Checks

- `cargo test -p hosted_runtimes` (`SQLX_OFFLINE` unset for DB tests).

## Gotchas

- Timers are never cancelled: `transition` ignores events that no longer apply,
  so a new state must guard every timer event it can receive.
- A Stripe failure after units are reserved emits `PurchaseFailed`; a purchase that
  Stripe applied but whose response was lost is caught by the webhook count diff.

## Related

- Skill: `cloud-storage-hexagonal-architecture` · Plan: Macro Computers Plan doc
