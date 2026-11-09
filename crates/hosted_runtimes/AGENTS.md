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
- Keep literal purchase resources in the versioned `domain::size::current_catalog`.
- Capacity is in units: `max(ceil(memory_gib / 8), ceil(vcpus / 4))`. Purchase
  reserves sold units on a host; waking checks awake units (`Context::host_has_room`).

## Start here

- `src/domain/lifecycle.rs` + `lifecycle/test.rs`: states, events, effects, invariants.
- `src/domain/service.rs`: the team-facing `ComputerService` (purchase, quote, status, power, retry, cancel, release).
- `src/domain/enrollment.rs`: the first-boot contract with `macrod enroll`.
- `src/domain/operator.rs`: the control plane (fleet effects, timers, reconcile,
  idle sleep, macrod presence, wake on prompt); wired in
  `services/agent_harness_service/src/computers.rs`.
- `src/inbound/axum_router.rs`: `/team/computers*` and `/internal/computers*`,
  mounted by authentication_service.
- `src/outbound/`: Postgres repo, `IncusFleet`, dev-only `DockerFleet`, and
  `ConfiguredFleet` (explicit `COMPUTERS_FLEET`, never a fallback).

## Rollout

`domain::rollout::ComputerRollout` reads `enable-macro-computers` for the
authenticated Macro user through `feature_flags`. Missing providers, missing
flags and load errors refuse team purchase, quote and offers with 403.
Composition roots inject it with `with_rollout`; `quote_for_team` takes the
caller user id. Existing reads and management, internal purchase/quote, Stripe
reconciliation and workers remain available when rollout is off.

## Explicit configuration

Report environment sale availability through `Billing::sales_available` and
reject unavailable purchases in the domain before reserving capacity. Map
`BillingError::NotAvailable` to 503 on public and internal computer routes;
keep missing subscription and unsupported billing intervals distinct.

Require image, host reserve and oversell factor for either enabled fleet;
require Docker memory for Docker, and explicit profile, storage pool,
request/connect/operation/state-change limits and shutdown grace for Incus.
See [the required variable list](../../docs/development/running-locally.md#macro-computers).
Keep lifecycle timings (`IDLE_AFTER`, `SUSPEND_AFTER`, `RETENTION`, backoffs,
leases and polling intervals) as named policy constants, not config defaults.
Reject invalid stored numeric capacity and retry counts rather than substituting values.

## Contracts

- **Fleet availability**: Inject `FleetAttachmentSource` explicitly into
  `ComputerService::new(repo, billing, clock, attachment)`; its `Attachment`
  generic has no default. Public `ComputerService::require_attached(&self)`
  returns `Result<(), ComputerError>` and is the gate HTTP-facing use cases
  run first; external callers call it before any repository read. Detached returns `ComputerError::FleetUnavailable`;
  attachment-source failures return `ComputerError::Internal`. `FleetAttachment`
  is `Attached` or `Detached` with no default; `FleetUnavailable` displays
  "computers are not available" and maps to HTTP 503 with `{message}`.
  Gate purchase, purchase_for_team (including comps), quote, quote_for_team,
  offers, list, status, set_power, retry, cancel, undo_cancel, release_now and
  notify_me before reads, billing or writes; preserve existing rollout denial
  first. Internal purchase/quote/status authenticate through `InternalOnly`
  before entering the same gate. Missing rows on a detached fleet return 503.
  Do not gate catalog(), size_spec(), reconcile_billed_counts,
  run_billing_effects or operator methods. PostgreSQL reports attached iff any
  host heartbeat is newer than `now - HOST_HEARTBEAT_FRESHNESS` (five minutes).
  Registration refreshes the heartbeat; every reconcile pass calls
  `heartbeat_host(host, now)` without changing capacity or startup timers.
  Heartbeats are advisory: authentication_service and agent_harness_service
  may briefly disagree; attachment is not a lease.
- **Maintenance**: `ComputerService::maintenance()` is for in-process domain
  integrations, never an HTTP route. `status_for_roster`
  returns `RosterComputerStatus { status, availability }` even when detached.
  `request_release(team_id, computer_id)` validates team ownership and applies
  `Event::ReleaseNow` through the repository, queuing normal billing, destroy
  and harness revocation effects without consulting fleet attachment or
  requiring name confirmation. Maintenance does not bypass team ownership or
  quarantine validation.
- **Sold resources**: Snapshot `ComputerResources { vcpus: Vcpus, memory_gib: MemoryGib, disk_gib: DiskGib }`,
  `CatalogEntryId` and `price_id` once at purchase. Comped rows have NULL price IDs;
  Stripe retries and removal use the saved price. Use the versioned catalog only
  for new offers and purchases; never infer size from resources. Fleet CPU/RAM/root
  limits, capacity and reconcile drift checks read recorded resources; Incus state
  space is memory + 1 GiB. Drift logs an operator error without resizing.
  Docker enforces/checks CPU and RAM only (overlayfs has no disk quota).
  Subscription reconcile compares saved price ids, never current catalog prices.
  `ComputerStatus` exposes `vcpus`, `memoryGib`, `diskGib`, `catalogEntry`.
  Read configured offers without billing through `ComputerService::catalog()`
  and `size_spec(size)`; omitted sizes return `ComputerError::BadRequest`.
  Apply forward migrations over the unchanged historical files. Legacy rows
  receive original resource snapshots and `size@legacy-2026-11` catalog IDs;
  their NULL Stripe prices require an explicit historical backfill before billing
  operations resume. Comped rows keep NULL prices.
  Purchaser deletion is RESTRICTed to retain enrollment/billing attribution until
  the computer or team is deleted; harness deletion clears its reference, and
  user deletion cascades waitlist requests.
- **Control-plane redeploys**: A missing macrod never reboots a fleet-observed
  Running guest. Persist consecutive misses; after three grace periods, page
  the operator and restart only macrod once per outage. Reconnection resets the
  counter; an obsolete daemon-restart effect is ignored. Stopped or missing
  awake guests retain crash/reprovision recovery. Crash-recovery effects use
  idempotent start, so replay after a lost completion cannot reboot a guest.
  Booting and disconnected Running guests use persisted `MacrodMissing` timer
  rows, never process uptime. On each successful operator registration, one SQL
  update gives that host's pending macrod timers a fresh three-minute grace;
  stale timer snapshots cannot consume the refreshed rows.
- **Effect shutdown and leases**: Keep `FOR UPDATE SKIP LOCKED` and ten-minute
  leases. Bound composite fleet calls to seven minutes and the entire leased
  batch (including lease acquisition, queueing and completion writes) to eight
  minutes; there is no lease heartbeat. Incus request/operation limits alone
  do not bound a composite effect. On cancellation, stop leasing, drain the
  current effect for up to thirty seconds, drop its future, then return only
  this batch's unfinished leases with their original deadline to `run_after =
  now`. Preserve recorded retry backoffs and replacement replicas' leases.
  Persist fleet completion, its lifecycle event, effects and timers atomically;
  preserve a macrod connection observed before creation completion.
  SIGKILL cannot release leases; replacements recover them at lease expiry.
  RPC cancellation does not cancel an Incus operation already accepted by the
  host (or a Docker daemon operation). Fleet create/start idempotence and
  idempotent crash recovery remain required; leases bound worker execution,
  not exactly-once execution of remote commands.
- **Fleet ownership**: Require explicit `COMPUTERS_CONTROL_PLANE_ID` whenever
  `COMPUTERS_FLEET` is `incus` or `docker`, shared across replicas but distinct per control plane.
  Stamp Incus `user.macro.control_plane` / Docker `macro.control_plane` at create;
  `Fleet::instances` lists only that owner's instances. Reconcile independently
  checks ownership and deletes orphans only after ten minutes. Creation timestamps
  are stamped once as `user.macro.created_at` / `macro.created_at`; missing or
  invalid timestamps prohibit orphan deletion. Never adopt unlabelled instances.
- **Capacity**: Every purchase holds oversold units until payment refusal or
  destruction, reserved under the host lock. `GET /team/computers/offers`
  reports `soldOut` per size.
- **Purchase**: `ComputerService::purchase(PurchaseRequest { team_id, created_by, size, name, extra_items, billing })`
  → `computer_id`. A Stripe purchase adds the computer's item plus
  every `extra_items` entry in one subscription update (`SubscriptionItem { price_id: StripePriceId, quantity }`, quantity
  added to the item's current quantity), invoiced at once with proration. In-process
  in authentication_service, and on the internal route `POST /internal/computers`.
  For Stripe, persist `PendingPayment` and a delayed `ConfirmPayment` outbox effect
  together before billing. Apply `PaymentConfirmed` in the purchase request as
  soon as Stripe succeeds, atomically clearing the recovery effect. Only unknown
  outcomes (provider errors or lost writes) wait for delayed confirmation;
  confirmed computers make recovery a no-op. Serialize payment resolution through
  its lifecycle write with the per-computer payment guard. Both the normal path
  and the two-minute safety net use
  `computer-add:{computer_id}` and the same extra items. Unknown outcomes stay
  pending and retry indefinitely with capped backoff; definite refusals become
  `PaymentFailed`, visible without holding capacity and clearable by release.
- **Payment provenance**: Persist `ComputerState.payment` as `pending` until
  payment confirmation latches `paid`, a comp latches `comped`, or refusal records `unbilled`; preserve it
  through release and expose it in every team/internal `ComputerStatus`.
  Unbilled computers never remove a billing item. Migrate legacy state before
  running code that requires this field; do not add serde defaults.
- **Quote**: `ComputerService::quote(team_id, size, &PurchaseBilling)` → `Quote { price_id, amount, currency, interval }`
  at the team subscription's interval.
- **Comped computers**: `PurchaseBilling::{Stripe, Comped { reason: String }}`
  selects funding on `PurchaseRequest` and `NewComputer`. `CompPolicy::comp_reason(team_id)`
  returns `Result<Option<String>, Self::Err>`; inject it with `with_comp_policy`.
  authentication_service wires `MacroStaffCompPolicy`: a verified owner/admin
  email at its explicitly configured domain qualifies the team. Team purchase calls
  `purchase_for_team(PurchaseRequest)` and overwrites billing from policy; its
  JSON body only accepts `size` and `name` (no client billing flag). Team quotes
  and offers also use policy (`quote_for_team`). Internal-key-only
  `POST /internal/computers` requires explicit `billing: { "kind": "stripe" }`
  or `{ "kind": "comped", "reason": "..." }`; its quote route remains Stripe.
  Comped purchases reject nonempty `extraItems` and never call the Billing port.
  Reservation applies `Event::Comped { reason }` in the reservation transaction
  to begin provisioning before commit; `PendingPayment` is never observable and
  no `ConfirmPayment` effect is emitted. Legacy pending comps can still recover
  through the billing worker. `PaymentOutcome::Comped` serializes as `"comped"`,
  with the reason exposed separately as `ComputerStatus.compReason: string | null`.
  Payment and reason remain latched through release. The optional persisted reason
  is absent on legacy Stripe rows; no migration is required.
  Comped computers never carry a charged subscription item, emit
  `RemoveBillingItem`, or count in `reconcile_billed_counts`; subscription webhooks
  cannot cancel them. Cancel-at-period-end stops them immediately (`at = now`)
  and retains the disk for the usual 14 days; undo is unavailable afterward.
  Cancel, release, retention expiry and delayed payment recovery make no Billing
  calls. A comped quote reads the Stripe quote and sets amount to zero, preserving
  price id, currency and interval. Without a subscription the quote returns
  `NoSubscription`; billing errors propagate.
- **Waiting for capacity**: Preserve stopped/suspended fleet state and project
  `wake_requested` with power On as `ComputerStatusKind::WaitingForCapacity`
  (also provisioning with `start: false`). Suppress setup progress while waiting.
  Persist `CapacityWait` after the first MakeRoom: check room after 20, 40, 80,
  160, 320, then 600 seconds, capped thereafter. Prompts and stale timers do not
  bypass the deadline or enqueue another MakeRoom. MakeRoom reports
  `RoomUnavailable` when nothing is frozen; retain the latch until
  `CapacityChanged`, even across worker restarts. Capped retries recheck room
  without repeating MakeRoom. Log each new deadline once.
  When a computer leaves awake, enqueue immediate `CapacityChanged` timers for
  waiters on its host in the same transaction. Lock the host before computer
  and timer rows, including timer delivery, to serialize wake reservations and
  avoid lock inversion. Power-off, successful wake and release clear the wait.
  Runtimes and Billing show "Waiting for space on the host" with a hint to turn
  off or release another computer. Waiting computers remain power-manageable.
- **Default agent**: the first macrod connection (`enrolled_at` unset) calls
  `Harnesses::create_default_agent`, which gives the team a coding agent on the
  computer's harness unless one is already bound (`DefaultAgent::{Created, AlreadyBound}`).
  It never runs again, so a deleted or rebound agent stays gone; a failure is
  recorded on the `computer.default_agent` span and enrollment carries on.
- **Status**: `ComputerService::status(team_id, computer_id)` / `list(team_id)` →
  `ComputerStatus` with `setup: Option<SetupProgress>` (Creating → Booting →
  Connecting → Ready, positions 1–4) until macrod first connects. Pending payment
  reports Creating (1 of 4); setup never exposes a payment phase. Payment outcomes
  remain in the billing fields `payment` and `compReason`. Readable by any team member.
- **Retry/reprovision**: `ComputerService::retry(team_id, computer_id)` → `ComputerStatus`,
  exposed to team admins at `POST /team/computers/{computer_id}/retry`. Only
  `Failed` computers can be retried; other phases return `NotFailed` (409).
  Applies `OperatorRetry` and never touches billing or purchases. A typed missing
  fleet instance completes its effect and applies `InstanceLost`: recreate on the
  same host, computer row and harness id, starting only with power On and room.
  Reconcile also detects missing Failed/Stopped/Suspended guests; awake guests
  first follow crash/restart. Re-enrollment re-keys the harness. A canceled
  computer with no guest becomes Destroyed and revokes its harness without
  removing billing again. Missing stop/destroy are idempotent successes.
- **Reprovision**: `InstanceLost` recreates the guest from the base image with a
  fresh pairing for the same harness; the guest disk is not restored.
- **Enrollment**: `Enrollment { computer_id, generation, pairing_id, device_secret, name, service_url_overrides, traceparent }`
  is the one-time `user.macro.enrollment` JSON or Docker file; the device secret
  is never stored in `hosted_runtime`, outbox effects, timers, or logs, and the
  fleet copy is removed by `clear_enrollment` after macrod connects.
  `Effect::Create { host, start, generation: EnrollmentGeneration }` carries no
  issuance material. `hosted_runtime.enrollment_generation` starts at zero and
  is reserved and advanced inside `ComputerRepo::apply`, atomically with the
  transition and Create outbox insert. First provisioning reserves 1; retries
  keep that generation even when creation or issuance fails. `InstanceLost`
  reserves its successor.
  Fleet Create checks the persisted generation and pairing identity before
  polling `FleetEnrollment::issue`: an already-claimed guest completes without
  issuance or re-keying. An unclaimed guest receives a fresh pairing and a
  restart of the enrollment and macrod units so its enroll oneshot applies the
  replacement values without rebooting a running guest. A stopped guest starts
  normally. Creation runs under the per-computer enrollment guard
  (`hosted-enrollment:<computer UUID>` advisory key), also taken by the harness
  claim transaction. Claims recheck the device-secret hash after acquiring it.
  This fences claims racing a retry, including retries after an expired effect lease.
- Fleet host discovery must not abort harness startup: report unhealthy and retry
  registration after 10, 20, 40, then 60 seconds, holding fleet effects and timers
  until registration succeeds without consuming their attempts.
- **Gateway**: computers call Claude via `ANTHROPIC_BASE_URL=<agent harness service>/anthropic`
  with a per-session token; see `services/agent_harness_service/AGENTS.md`.

## Typed boundaries

- Keep `#![deny(missing_docs)]` enabled and document every public item tersely (CS-54).

- Use shared `computer_id::ComputerId`, `pairing_id::PairingId` (re-exported by `domain::ids`), `domain::ids::HostId` and `harness_id::HarnessId`; keep team IDs as UUIDs until a shared team identity exists. Convert only at external/storage boundaries.
- Pass `MacroUserIdStr<'static>` through domain models, ports and services; parse inbound strings and stored buyers at their adapter boundaries. Keep wire fields as strings.
- Construct `ComputerName` to trim and validate display names. `DeviceSecret` redacts Debug/Display and zeroizes on drop; expose only for pairing or enrollment transport. It deliberately has no Serialize implementation.
- Keep serde newtypes transparent and validate string deserialization through `TryFrom<String>`; serde does not allow `transparent` together with its `try_from` container attribute.

## Scope

- Owns: computer rows, hosts, outbox, timers, waitlist, lifecycle, size catalog.
- Not here: harness rows and pairing → `crates/harnesses`; the subscription's
  seat logic → `crates/teams`; macrod enrollment → `crates/coding_agent_worker`.
- Sizes are this crate's own; do not reuse `agent_harness`'s `SandboxSize`.

## Checks

- `cargo test -p hosted_runtimes` (`SQLX_OFFLINE` unset for DB tests).
- With `macro-box:latest` loaded, run the Docker isolation regression with
  `cargo test -p hosted_runtimes listing_cannot_expose_another_fleets_containers_to_reconciliation -- --ignored`.

## Gotchas

- Preserve undecodable rows as `ComputerRecord::NeedsAttention` with row id, team,
  host and a static field-and-rule reason; never include parser errors or stored
  values in quarantine logs. Keep their ids in expected instances and treat
  quarantine as present in orphan checks. Only validated computers receive
  lifecycle events or have effects/timers selected; repair resumes pending work.
  Retain raw purchase metadata for display only; quarantine reports null payment.

- DockerFleet enforces recorded vCPU and memory limits through cgroups without
  CPU pinning; dev-only Docker guests still see host totals in `/proc` and
  `nproc`. Do not add lxcfs; Incus VMs see their real CPU and memory limits.

- Demo Incus access uses Wolf's own Tailscale tailnet; production must use
  the company tailnet. Admin access is Tailscale SSH via `root@runtime-dev-1`
  (MagicDNS); serial console is break-glass. See `nix/hosts/README.md` for the
  last-IAP switch, root-only auth-key file transfer, and tailnet rebuild commands.

- Lifecycle state stores the phase tag at `state.phase.phase`; SQL selectors must read that nested tag.
- V1 runs one fleet (one host) per control plane; an effect for another host fails.
- Shared hosts require distinct `COMPUTERS_CONTROL_PLANE_ID` per control plane;
  only owned instances are reconciled. Local stacks use `local-<instance>`.
- Scope Docker fleet listing to both its configured network and control-plane
  label; never reconcile foreign or unlabelled guests on shared hosts.
- `PageOperator` is the log event `computer needs an operator` (error level);
  alerts key on it.
- Each computer's effects run strictly in outbox order (`lease_effects` leases
  only a computer's oldest effect per worker).
- Timers are never cancelled: `transition` ignores events that no longer apply,
  so a new state must guard every timer event it can receive.
- Unresolved payment retries log `computer payment unresolved` at error level.

## Related

- Skill: `cloud-storage-hexagonal-architecture` · Plan: Macro Computers Plan doc

## Observability

One computer's first setup is one trace, rooted at the purchase (Buy computer). See the [setup trace runbook](../../docs/runbooks/computer-setup-traces.md).

- `ComputerState.provision_traceparent` holds the purchase W3C parent and
  `ComputerState.setup` (`domain::setup::SetupTimeline`) the setup milestones,
  both in the state JSON (no column). Older rows have no timeline.
- Start new worker spans with `telemetry::adopt` before entering them
  (`computer.fleet.work`, `computer.billing.effect`, `computer.timer`,
  `computer.reconcile.drift`, `computer.macrod.connected`): parented under the
  purchase while setup runs, linked to it afterwards, so later power changes
  never grow the setup trace. Already-entered callbacks use `resume` (link).
- `apply_locked` advances the timeline after each transition and exports the
  waits that ended, with their recorded start and end, through the global
  tracer: `computer.setup.payment` (reservation → paid/comped),
  `computer.setup.create` (→ guest booting, including outbox and capacity
  waits), `computer.setup.boot` (→ first macrod connection) and the total
  `computer.setup`. They carry `computer_id`, `team_id`, `size`, `host_id`,
  `generation`, `billing_kind` and `capacity_waited`. A rolled-back
  transaction can export a wait that a retry exports again.
- `Enrollment.traceparent` carries the setup context to macrod; see
  `crates/coding_agent_worker/AGENTS.md`.
- Fleet work and billing work emit one span per claimed effect, with errors
  marked even when retry scheduling succeeds.
- Metrics: `computer.setup.phase.duration` (seconds, by `phase`),
  `computer.setup.duration` (reservation → first macrod connection),
  `computer.provisioning.duration` (the same total, unlabelled),
  `computer.effect.failures` (by phase) and `computer.incus.reachable` (0/1).
