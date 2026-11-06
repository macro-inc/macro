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

## Contracts (PR B, agent brains, builds on these — keep them stable)

- **Sold resources**: Snapshot `ComputerResources { vcpus: Vcpus, memory_gib: MemoryGib, disk_gib: DiskGib }`,
  `CatalogEntryId` and `price_id` once at purchase. Comped rows have NULL price IDs;
  Stripe retries and removal use the saved price. Use the versioned catalog only
  for new offers and purchases; never infer size from resources. Fleet CPU/RAM/root
  limits, capacity and reconcile drift checks read recorded resources; Incus state
  space is memory + 1 GiB. Drift logs an operator error without resizing.
  Docker enforces/checks CPU and RAM only (overlayfs has no disk quota).
  Subscription reconcile compares saved price ids, never current catalog prices.
  `ComputerStatus` exposes `vcpus`, `memoryGib`, `diskGib`, `catalogEntry`.
  PR B: the unpublished hosted-runtimes migration was rewritten in place;
  reset existing local databases before applying it.
  Purchaser deletion is RESTRICTed to retain enrollment/billing attribution until
  the computer or team is deleted; harness deletion clears its reference, and
  user deletion cascades waitlist requests.
- **Fleet ownership**: Require explicit `COMPUTERS_CONTROL_PLANE_ID` whenever
  `COMPUTERS_FLEET` is set, shared across replicas but distinct per control plane.
  Stamp Incus `user.macro.control_plane` / Docker `macro.control_plane` at create;
  `Fleet::instances` lists only that owner's instances. Reconcile independently
  checks ownership and deletes orphans only after ten minutes. Creation timestamps
  are stamped once as `user.macro.created_at` / `macro.created_at`; missing or
  invalid timestamps prohibit orphan deletion. Never adopt unlabelled instances.
- **Purchase**: `ComputerService::purchase(PurchaseRequest { team_id, created_by, size, name, persona, extra_items, billing })`
  → `computer_id`. A Stripe purchase adds the computer's item plus
  every `extra_items` entry in one subscription update (`SubscriptionItem { price_id: StripePriceId, quantity }`, quantity
  added to the item's current quantity), invoiced at once with proration. In-process
  in authentication_service, and on the internal route `POST /internal/computers`.
  Persist `PendingPayment` and a delayed `ConfirmPayment` outbox effect together
  before billing. Serialize payment resolution through its lifecycle write with
  the per-computer payment guard. Both the normal path and the two-minute safety net use
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
  authentication_service explicitly wires `NoComps`. Team purchase calls
  `purchase_for_team(PurchaseRequest)` and overwrites billing from policy; its
  JSON body only accepts `size` and `name` (no client billing flag). Team quotes
  and offers also use policy (`quote_for_team`). Internal-key-only
  `POST /internal/computers` requires explicit `billing: { "kind": "stripe" }`
  or `{ "kind": "comped", "reason": "..." }`; its quote route remains Stripe.
  Comped purchases reject nonempty `extraItems` and never call the Billing port.
  Reservation persists `state.comp_reason` before the delayed confirmation effect;
  normal purchase and crash recovery apply `Event::Comped { reason }` to begin
  provisioning. `PaymentOutcome::Comped` serializes as `"comped"`, with the
  reason exposed separately as `ComputerStatus.compReason: string | null`.
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
- **Status**: `ComputerService::status(team_id, computer_id)` / `list(team_id)` →
  `ComputerStatus` with `setup: Option<SetupProgress>` (Paying → Creating → Booting →
  Connecting → Ready) until macrod first connects. Readable by any team member.
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
- **Reprovision**: `InstanceLost` recreates the guest from the base image with the
  saved persona and a fresh pairing for the same harness; the guest disk is not restored.
- **Persona**: `Persona { name, os_user, extra_service: { unit_name, exec, env }, config }`.
  `macrod enroll` creates `os_user`, writes `config` to `/etc/macro/personas/<os_user>.env`
  (the unit's `EnvironmentFile`), and installs + starts `/etc/systemd/system/<unit_name>.service`
  as that user. `PersonaOsUser`, `SystemdUnitName`, and `PersonaConfigKey` in
  `domain::enrollment` validate names and keys on construction and JSON reads;
  `PersonaOsUser` requires `^[a-z_][a-z0-9_-]{0,30}$`, excluding root, macro and macrod*;
  `PersonaConfigKey` supports borrowed string map lookups. `Persona` and
  `PersonaService` Debug redact config and env values.
  `service::validate_persona` checks commands and values. Persisted config and
  service env reject credential names ending in `_TOKEN`, `_KEY`, or `_SECRET`
  (case-insensitive) with `PersonaFieldError::ReservedConfigKey`.
- **Persona credentials**: `PersonaCredentialSource::issue(computer, generation)`
  returns `PersonaEnrollment { secrets: PersonaCredentials, env: PersonaEnv }`.
  Each call rotates credentials; neither half is stored in `hosted_runtime`,
  outbox effects, timers, or logs. `PersonaCredentials` has validated
  `PersonaConfigKey` names, Debug lists keys only, values zeroize on drop,
  and it does not implement Serialize. Only `Enrollment.persona_enrollment`
  serializes it for the one-time `user.macro.enrollment` JSON or Docker file.
  That is the only transient fleet copy, removed by `clear_enrollment` after
  macrod connects. Enrollment Debug redacts secrets. macrod merges both halves
  with non-secret persona config into the guest's mode-0600
  `/etc/macro/personas/<os_user>.env` before claiming the pairing.
- Persona computers are never idle-frozen; they run until powered off or canceled.
- Fleet host discovery must not abort harness startup: report unhealthy and retry
  registration after 10, 20, 40, then 60 seconds, holding fleet effects and timers
  until registration succeeds without consuming their attempts.
- **Gateway**: computers call Claude via `ANTHROPIC_BASE_URL=<agent harness service>/anthropic`
  with a per-session token; see `services/agent_harness_service/AGENTS.md`.

## Typed boundaries

- Use `domain::ids::{ComputerId, PairingId, HostId}` and `harness_id::HarnessId`; keep team IDs as UUIDs until a shared team identity exists. Convert only at external/storage boundaries.
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

- Demo Incus access uses Wolf's personal Tailscale tailnet; production must use
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
