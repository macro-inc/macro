# hosted_runtimes

## What it is

Macro computers: hosted VMs a team buys, each running macrod so it shows up
in Settings → Runtimes like a paired machine. This crate owns the computer
lifecycle, capacity, purchase/billing orchestration and the fleet ports.

## How it works

- `domain::lifecycle::transition(state, event, context) -> Result<(state, effects), Rejected>`
  is pure. `ComputerRepo::apply` locks the row (and host), runs it, and stores
  the state, outbox effects and timers in one transaction; a `Rejected`
  request writes nothing and comes back as `Applied::Rejected`, which the
  service maps to `ComputerError::Rejected` (409). The service never re-checks
  phases; `lifecycle::undo_allowed`/`restore_allowed` are the rules it asks
  before re-adding a billing item.
- The state holds two machines side by side: `Phase` (the guest: Provisioning,
  Booting, Running, Crashed{restarts, retry}, Stopping, Stopped, Destroying)
  and `Billing` (Active{item}, PastDue{since, item}, EndsAt{at}, Comped{reason}),
  both in `hosted_runtime.state` (`state.phase.phase`, `state.billing.billing`).
  The host is a column and a `Computer` field, not part of the phase. Billing
  events change only `Billing` and emit the machine effects billing calls for.
  `Crashed` with no `retry` gave up (too many crashes, a failed effect, a lost
  host): it paged, and `OperatorRetry` restarts it.
- Effects run in workers keyed by outbox id: `Billing` effects where Stripe lives
  (authentication_service), `Fleet` effects and timers in agent_harness_service.
- Keep literal purchase resources in the versioned `domain::size::current_catalog`.
- Capacity is in units: `max(ceil(memory_gib / 8), ceil(vcpus / 4))`. Purchase
  reserves sold units on a host; starting checks awake units (`Context::host_has_room`).
- A powered-on computer stays Running until the team turns it off (Stopped).
  Fleets never pause guests; a paused Docker container is an unknown state.

## Start here

- `src/domain/lifecycle.rs` + `lifecycle/test.rs`: states, events, effects, invariants.
- `src/domain/service.rs`: the team-facing `ComputerService` (purchase, quote, status, power, retry, cancel, release).
- `src/domain/enrollment.rs`: the first-boot contract with `macrod enroll`.
- `src/domain/image.rs`: versioned images and the root/data disk split.
- `src/domain/operator.rs`: the control plane (fleet effects, timers, reconcile,
  macrod presence); wired in
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
Retention (14 days) and past-due grace (7 days) are the typed
`lifecycle::BillingPolicy`, from `COMPUTER_RETENTION_DAYS` and
`COMPUTER_PAST_DUE_GRACE_DAYS` (typed config defaults, same in both services); `PgComputerRepo::new(pool,
policy)` applies every transition with it (`ComputerRepo::policy`). Keep the
other lifecycle timings (`MACROD_GRACE`, `RESERVATION_TTL`, leases, polling)
as named policy constants. Every backoff goes through
`lifecycle::backoff(Backoff, attempt)` on tokio-retry's `ExponentialBackoff`
(`CAPACITY_BACKOFF`, `RESTART_BACKOFF`, `BILLING_BACKOFF`, the operator's
fleet and registration backoffs); never hand-roll doubling.
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
  offers, status, set_power, retry, cancel, undo_cancel, release_now and
  notify_me before reads, billing or writes; preserve existing rollout denial
  first. Internal purchase/quote/status authenticate through `InternalOnly`
  before entering the same gate. Missing rows on a detached fleet return 503.
  Do not gate catalog(), size_spec(), observe_subscription, confirm_reservations,
  run_billing_effects, operator methods or `list`: every team member's
  Settings and Billing list the team's computers, so a detached fleet still
  answers 200 with its rows (empty for a team without computers). PostgreSQL reports attached iff any
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
  `CatalogEntryId` and the price (or comp reason) once at purchase. Comped rows
  have NULL price IDs; restores copy the saved price. Use the versioned catalog only
  for new offers and purchases; never infer size from resources. Fleet CPU/RAM/root
  limits, capacity and reconcile drift checks read recorded resources.
  Drift logs an operator error without resizing.
  Docker enforces/checks CPU and RAM only (overlayfs has no disk quota).
  The disk quota splits into a fixed `image::ROOT_DISK_GIB` (32 GiB) root disk
  and a data disk of the rest (`image::data_disk_gib`; 68/168/368 GiB for the
  current sizes); drift checks compare the root disk only.
  Subscription reconcile matches computer ids, never prices.
  `ComputerStatus` exposes `vcpus`, `memoryGib`, `diskGib`, `catalogEntry`.
  Read configured offers without billing through `ComputerService::catalog()`
  and `size_spec(size)`; omitted sizes return `ComputerError::SizeNotOffered`.
  The schema is one migration (`*_macro_computers.sql`, plus the concurrent
  harness index); a row with both or neither of a price and a comp reason is
  quarantined.
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
- **Capacity**: free sold units are sold capacity minus the units of live
  computers (phase not `destroying`) and unexpired reservations, reserved under
  the host lock. `GET /team/computers/offers` reports `soldOut` per size.
- **Purchase**: `ComputerService::purchase(PurchaseRequest { billing, purchase_key, team_id, created_by, size, name, extra_items })`
  → `Purchase::{Ready(id), Confirming(id)}`. The client's `purchase_key` (one
  per Buy dialog, reused on retry) makes `ComputerRepo::reserve` return what
  the key already led to (`Reserved::{New, Pending, Purchased}`), so a retry
  never charges twice or buys a second computer; a key used by another team
  or size is `PurchaseKeyConflict`. A `computer_reservation` row (id = the
  future computer id) holds the units until `expires_at` (`RESERVATION_TTL`,
  15 minutes). The charge is ONE subscription update adding the computer's
  own item (`computer_id` metadata, a price of its own) plus `extra_items`,
  `always_invoice` + `error_if_incomplete`, Stripe idempotency key
  `computer-add:{reservation id}`. Definite success converts the reservation
  (`convert_reservation`: delete it, insert the computer in Provisioning with
  `Billing::Active{item}`, enqueue Create, in one transaction); a definite
  refusal deletes it and returns the typed error; an unknown outcome answers
  `Confirming` (HTTP 202). `confirm_reservations` (run by the billing worker)
  replays the same idempotent update for reservations older than
  `CONFIRM_DELAY` until expiry, then `settle_computer_add` abandons the change
  for good and converts only if the subscription carries an item with the
  computer's id; otherwise the reservation is deleted. An error shown to the
  buyer therefore always means nothing was charged. Status/list show a
  reservation as status `purchasing` (setup step Creating); every request on
  it is `ComputerError::NotPurchased` (409).
- **Billing**: cancel removes the item at once without proration (the period
  is paid) → `EndsAt{at = period end}` and a `BillingEnds` timer at `at` that
  stops the computer and starts retention (`RetentionExpired` at `at +
  retention` destroys it). Undo before `at` re-adds an item without proration;
  after `at` it is `Rejected::BillingEnded` and restore
  (`POST /team/computers/{id}/restore`) re-adds it prorated, keeping the
  stopped guest. A re-add first reuses an item already carrying the computer
  id (an earlier unknown outcome). Release now removes the item and destroys.
  `RemoveBillingItem{item}` treats an item or subscription already gone as
  removed and, after `MAX_BILLING_ATTEMPTS`, logs `computer billing item
  removal abandoned` (a Datadog monitor in `infra/stacks/monitoring`) and
  stops. `observe_subscription(team, SubscriptionObserved)` is the one billing
  owner for webhooks: items are matched by `computer_id`, never by price or
  count; a billed computer whose item is missing (or whose subscription
  ended) gets `BillingItemMissing` (ends billing now, retention); past
  due/unpaid/paused → `PaymentLapsed` (`PastDue`, the computer is turned off
  after the grace, never destroyed); paid again → `PaymentRecovered`. A
  snapshot read before a computer's `billing_changed_at` cannot change it.
  Items naming no known computer are logged, never mapped.
- **Team deletion**: `TeamComputerRelease::release_team` releases every live
  computer through the normal effects and deletes the team's reservations;
  teams calls it before cancelling the subscription. `hosted_runtime.team_id`
  has no foreign key, so rows outlive the team until their effects ran.
- **Quote**: `ComputerService::quote(team_id, size, &PurchaseBilling)` → `Quote { price_id, amount, currency, interval }`
  at the team subscription's interval.
- **Comped computers**: `PurchaseBilling::{Stripe, Comped { reason: String }}`
  selects funding on `PurchaseRequest`; it is saved as `Funding` (price id or
  comp reason; `price_id`/`comp_reason` columns). `CompPolicy::comp_reason(team_id)`
  returns `Result<Option<String>, Self::Err>`; inject it with `with_comp_policy`.
  authentication_service wires `MacroStaffCompPolicy`. Team purchase calls
  `purchase_for_team(PurchaseRequest)` and overwrites billing from policy; its
  JSON body only accepts `purchaseKey`, `size` and `name`. Team quotes and
  offers also use policy (`quote_for_team`). Internal-key-only
  `POST /internal/computers` requires explicit `billing: { "kind": "stripe" }`
  or `{ "kind": "comped", "reason": "..." }` and a `purchaseKey`. Comped
  purchases reject nonempty `extraItems` (`CompedExtraItems`), never call the
  Billing port, and convert at once with `Billing::Comped{reason}`. A comped
  cancel stops at once and starts retention; restore comps it again. A comped
  quote reads the Stripe quote and sets amount to zero.
- **Waiting for capacity**: Preserve stopped fleet state and project
  `power_on_requested` with power On as `ComputerStatusKind::WaitingForCapacity`
  (also provisioning with `start: false`). Suppress setup progress while waiting.
  Persist the wait as `capacity_wait: Retry { attempt, next_at }` on the
  first blocked start: check room after `CAPACITY_BACKOFF` (20, 40, 80, 160,
  320, then 600 seconds, capped). A repeated power-on or a
  stale timer does not bypass the deadline. Log each new deadline once.
  When a computer leaves awake, enqueue immediate `CapacityChanged` timers for
  waiters on its host in the same transaction. Lock the host before computer
  and timer rows, including timer delivery, to serialize start reservations and
  avoid lock inversion. Power-off, a successful start and release clear the wait.
  Runtimes and Billing show "Waiting for space on the host" with a hint to turn
  off or release another computer. Waiting computers remain power-manageable.
- A bought computer's harness starts with "Don't ask before acting" on: the
  harnesses service creates every hosted harness with `allow_permission_bypass`.
- **Default agent**: the first macrod connection (`enrolled_at` unset) calls
  `Harnesses::create_default_agent`, which gives the team a coding agent on the
  computer's harness unless one is already bound (`DefaultAgent::{Created { agent_id }, AlreadyBound}`).
  A created agent's bot id is stored as `hosted_runtime.default_agent_id` and
  exposed as `ComputerStatus.defaultAgentId` (it can name a since-deleted agent).
  It never runs again, so a deleted or rebound agent stays gone; a failure is
  recorded on the `computer.default_agent` span and enrollment carries on.
- **Agents go with the computer**: `Harnesses::revoke(&Computer)` (the
  `RevokeHarness` effect of release and retention expiry) deletes the harness,
  then every agent bound to it, inside the one effect. The harness delete locks
  its row `FOR UPDATE` and agent binds hold it `FOR SHARE`, so a concurrent
  bind is either deleted too or refused. `ComputerStatus.agentCount` counts the
  live agents on the computer's live harness, teammates' private ones included
  (`ComputerRepo::agent_counts`), for the release warning.
- **Guided setup**: `POST /team/computers/{computer_id}/setup-complete` →
  `ComputerStatus`, `ComputerService::complete_setup`, records
  `setupCompletedAt` once (idempotent). Allowed to the computer's buyer and the
  team owner, the server rule behind the web's `canManageClaude`; others get 403.
- **Status**: `ComputerService::status(team_id, computer_id)` / `list(team_id)` →
  `ComputerStatus` with `setup: Option<SetupProgress>` (Creating → Booting →
  Connecting → Ready, positions 1–4) until macrod first connects. A purchase
  being confirmed reports status `purchasing`, step Creating (1 of 4).
  Billing is `billing` (`purchasing`, `active`, `past_due`, `ending`,
  `ended`, `comped`) with `cancelsAt`, `canUndoCancel`, `retainedUntil`,
  `canRestore`, `pastDueSince` and `compReason`. Readable by any team member.
- **Retry/reprovision**: `ComputerService::retry(team_id, computer_id)` → `ComputerStatus`,
  exposed to team admins at `POST /team/computers/{computer_id}/retry`. Only
  computers that gave up (`Crashed` with no retry) can be retried; the
  lifecycle rejects others with `Rejected::NotFailed` (409).
  Applies `OperatorRetry` and never touches billing or purchases. A typed missing
  fleet instance completes its effect and applies `InstanceLost`: recreate on the
  same host, computer row and harness id, starting only with power On and room.
  Reconcile also detects missing gave-up/Stopped guests; awake guests
  first follow crash/restart. Re-enrollment re-keys the harness. A lost guest
  whose billing ended becomes Destroying with a Destroy effect (so the fleet
  still deletes its data volume) and revokes its harness, without removing
  billing again. Missing stop/destroy are idempotent successes.
- **Reprovision**: `InstanceLost` recreates the guest from the fleet's
  configured image with a fresh pairing for the same harness, on the data
  disk the lost guest left (homes, Claude login and Docker data survive).
  The new enrollment generation makes `macrod enroll` run again: it claims
  the new pairing and replaces only the enrollment marker and credential.
- **Data disk**: every computer has one, created with the guest and deleted
  by `Fleet::destroy` after the instance (Incus keeps custom volumes). Incus:
  block volume `<instance>-data` in the configured pool, disk device `data`
  in the instance create request, so no instance exists without it; the guest
  mounts it at `/home` and keeps `/var/lib/macrod` there. Docker: named
  volumes `macro-computer-<id>-home` (`/home`) and `-macrod`
  (`/var/lib/macrod`). Create and destroy are idempotent and leave no volume
  behind a destroyed computer.
- **Images**: images are versioned aliases (`macro-box/<version>` on Incus,
  `macro-box:<tag>` on Docker); `COMPUTERS_IMAGE` names the one new computers
  get. `hosted_runtime.image` records the image each computer was created
  from (`Fleet::create` returns it, stamped as `user.macro.image` /
  `macro.image` on the guest). Updating running computers to a new image is
  not built yet; it will be a fleet-wide rollout, not a per-computer API.
- **Enrollment**: `Enrollment { computer_id, generation, pairing_id, device_secret, name, deployment, traceparent }`
  is the one-time `user.macro.enrollment` JSON or Docker file. `deployment`
  (agent harness, document storage, app and egress URLs) comes from the
  injected `DeploymentSource` for each enrollment and is never stored; the device secret
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
- **Claude sign-in notices**: `domain::claude_sign_in::due_notice(now, sign_in)`
  is pure: within three days of the reported expiry `ExpiresSoon`, within one
  day `ExpiresToday`, once passed (or macrod reports Claude signed out)
  `Expired`. Only a report newer than the recorded sign-in counts. Each
  `ClaudeSignIn` is a computer's active Claude login, and its last notice
  (stage and the expiry it warned about) is stored on that login row
  (`harness_account_logins.notice_*`), so a new sign-in starts over; one for an
  older expiry no longer counts,
  nothing follows `Expired` for the same sign-in, and a later stage skips the
  ones it overtook. `ComputerOperator::notify_claude_sign_ins(sign_ins, notices)`
  sends each due notice to the signer plus the team's owner and admins, then
  records it; a failed send is not recorded, so the next pass retries it, and
  one computer's failure never stops the rest. Span:
  `computer.claude_sign_in.check` (`checked`, `notified`, `failed`); never put
  user ids or emails on it. The ports (`ClaudeSignIns`, `ClaudeSignInNotices`)
  are implemented in agent_harness_service.
- **Gateway**: computers call Claude via `ANTHROPIC_BASE_URL=<agent harness service>/anthropic`
  with a per-session token; see `services/agent_harness_service/AGENTS.md`.

### Agent teammate computers

`ComputerService::purchase_for_agent` is `purchase_for_team` with the computer
linked to an agent account (`hosted_runtime.agent_user_id`, one computer per
agent); `ComputerAgents` reads the link. This crate knows nothing else about
the agent: at enrollment the operator asks its `AgentEnrollmentSource`
(`domain/agent.rs`) for `Enrollment.agent`, which team_agents issues. A failed
issuance fails the enrollment, so an agent computer never boots without its
agent; `NoAgentEnrollment` (the default) enrolls every computer without one.

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
- `cargo run -p hosted_runtimes --example incus_fleet_smoke -- …` drives
  create → stop → start → destroy against a dev Incus host.
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

- Lifecycle state stores the phase tag at `state.phase.phase` and the billing
  tag at `state.billing.billing`; SQL selectors must read those nested tags.
  Size, effect worker, timer kind, notice stage and provider are Postgres
  enums mapped with `sqlx::Type` (`ComputerSize`, the adapter's
  `OutboxWorker`, `TimerKind`, `ClaudeSignInStage`, `AgentProvider`).
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
- A purchase whose charge cannot be settled at expiry logs `computer payment
  unresolved` at error level and keeps its reservation for the next pass.

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
  tracer: `computer.setup.payment` (reservation → conversion),
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
