# Macro computers

How Macro computers work: hosted VMs a team buys, each running macrod so it
shows up in Settings → Runtimes like a paired machine. The code lives in
`crates/hosted_runtimes` (see its `AGENTS.md` for navigation), with the control
plane wired in `services/agent_harness_service/src/computers.rs` and the routes
mounted by authentication_service.
Their isolation and threat model is in
[Firecracker computers: security and isolation](firecracker-computers-security.md).

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
  host): it paged, and `OperatorRetry` restarts it. A give-up stops nothing,
  so a sign of life ends one whose cause can pass (`Failure::ended_by`):
  macrod connecting ends `Power` and `KeptCrashing`, the agent reporting
  online ends those and `AgentNotStarted`; the computer is `Running` again
  with its failure cleared. `Create`, `SetupExhausted`, `AgentUnsupported`,
  `HostLost` and `Payment` wait for a retry. A give-up leaves
  `macrod_connected` as observed.
- The team sees `ComputerStatusKind::Unhealthy` for a computer past its
  first connection that is `Running` with macrod missing at one or more
  `MACROD_GRACE` checks (`macrod_misses >= 1`, so a reconnect flap stays
  Ready; never while hibernated), `Crashed` with a restart scheduled, or
  `Booting` again after a crash inside `CRASH_WINDOW` or with a missed check
  (a retry boot, or a power-on or move with no recent crash, reads
  Starting). Before the first
  connection the same states read as setting up; only a give-up reads Failed.
- Effects run in workers keyed by outbox id: `Billing` effects where Stripe lives
  (authentication_service), `Fleet` effects and timers in agent_harness_service.
  A failed fleet effect retries with backoff up to `MAX_EFFECT_ATTEMPTS`, except
  a `FleetError::is_permanent` one (the host refused the request as invalid), which
  fails the computer at once (`EffectFailed`, shown to the team as Failed).
  A give-up stores a `lifecycle::Failure` kind; `ComputerStatus.failureReason`
  is its fixed user-safe sentence, and the raw error stays in the logs and the
  operator page. `setup.stepStartedAt` is when the current setup step began
  (null for Booting, which records no start).
- Keep literal purchase resources in the versioned `domain::size::SIZE_SPECS`
  (`current_catalog` maps it to offers). Each tier writes out every quantity;
  the size tests fail if its root disk, `/home` disk or units disagree with
  what the fleet derives from a recorded purchase:

  | Tier | Catalog entry | vCPUs | Memory | Root disk | `/home` | Disk quota | Units |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | Standard | `standard@2026-11` | 4 | 8 GiB | 32 GiB | 68 GiB | 100 GiB | 1 |
  | Large | `large@2026-11` | 8 | 16 GiB | 32 GiB | 168 GiB | 200 GiB | 2 |
  | XL | `xl@2026-11` | 16 | 32 GiB | 32 GiB | 368 GiB | 400 GiB | 4 |

  Prices are per-size Stripe config (`computer_billing`), not derived from
  resources. `SizeOffer.memoryGb`/`diskGb` carry GiB despite their wire names.
- Capacity is in units: `max(ceil(memory_gib / 8), ceil(vcpus / 4))`. Purchase
  reserves sold units on a host; starting checks awake units (`Context::host_has_room`).
- A powered-on computer stays Running until the team turns it off (Stopped).
  Fleets never pause guests; a paused Docker container is an unknown state.

## Rollout

`domain::rollout::ComputerRollout` reads `enable-macro-computers` for the
authenticated Macro user through `feature_flags`. Missing providers, missing
flags and load errors refuse team purchase and offers with 403.
Composition roots inject it with `with_rollout`; `offers` takes the caller
user id. Existing reads and management, Stripe reconciliation and workers remain
available when rollout is off. The web hides the computer UI with rollout off
while existing computers keep running and billing: the flag is a sales kill
switch, not a way to manage computers.

Dev only, `COMPUTERS_ROLLOUT_ALLOWLIST` (comma-separated Macro user ids, read by
authentication_service and agent_harness_service) admits those users without the
flag, so a deployment can be tested before its PostHog targeting exists. Startup
refuses it in production. The web shows the computer UI from the backend's
answer (`GET /team/computers/rollout`, the same `ComputerRollout` check), never
from its own PostHog read, so the flag and the allowlist drive both.

## Explicit configuration

Report environment sale availability through `Billing::sales_available` and
reject unavailable purchases in the domain before reserving capacity. Map
`BillingError::NotAvailable` to 503 on the team computer routes;
keep missing subscription and unsupported billing intervals distinct.

Require both images, host reserve and oversell factor for either enabled fleet;
require Docker memory for Docker, and the client certificate and key every
Firecracker host agent trusts for Firecracker (each host's endpoint and pinned
certificate are on its `hosted_runtime_host` row).
See [the required variable list](../development/running-locally.md#macro-computers).
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
In agent_harness_service the operator's repository has its own small pool
(`OPERATOR_CONNECTIONS`, a 10 s acquire timeout), apart from the session pool.
A pool timeout reaches the domain as `ports::StorageUnavailable`
(`ComputerError::is_storage_unavailable`): a pass skips its tick and warns once
per outage, and a fleet or billing effect is retried later without spending an
attempt, so a busy database never fails a computer or abandons a removal.

## Contracts

- **Fleet availability**: Inject `FleetAttachmentSource` explicitly into
  `ComputerService::new(repo, billing, clock, attachment)`; its `Attachment`
  generic has no default. Public `ComputerService::require_attached(&self)`
  returns `Result<(), ComputerError>` and is the gate HTTP-facing use cases
  run first; external callers call it before any repository read. Detached returns `ComputerError::FleetUnavailable`;
  attachment-source failures return `ComputerError::Internal`. `FleetAttachment`
  is `Attached` or `Detached` with no default; `FleetUnavailable` displays
  "computers are not available" and maps to HTTP 503 with `{message}`.
  Gate purchase, purchase_for_team (including comps), offers, set_power, retry, cancel, undo_cancel and release_now
  before reads, billing or writes; preserve existing rollout denial
  first. Missing rows on a detached fleet return 503.
  Do not gate catalog(), size_spec(), observe_subscription, confirm_reservations,
  run_billing_effects, operator methods or `list`: every team member's
  Settings and Billing list the team's computers, so a detached fleet still
  answers 200 with its rows (empty for a team without computers). PostgreSQL reports attached iff any
  host heartbeat is newer than `now - HOST_HEARTBEAT_FRESHNESS` (five minutes).
  Registration refreshes the heartbeat; every reconcile pass calls
  `heartbeat_host(host, now)` without changing capacity or startup timers.
  Heartbeats are advisory: authentication_service and agent_harness_service
  may briefly disagree; attachment is not a lease.
- **Sold resources**: Snapshot `ComputerResources { vcpus: Vcpus, memory_gib: MemoryGib, disk_gib: DiskGib }`,
  `CatalogEntryId` and the price (or comp reason) once at purchase. Comped rows
  have NULL price IDs; restores copy the saved price, and a comped restore asks
  `CompPolicy` again (refused once the team is no longer comped). Use the versioned catalog only
  for new offers and purchases; never infer size from resources. Fleet CPU/RAM/root
  limits, capacity and reconcile drift checks read recorded resources.
  Drift logs an operator error without resizing.
  Docker enforces/checks CPU and RAM only (overlayfs has no disk quota).
  The disk quota splits into a fixed `image::ROOT_DISK_GIB` (32 GiB) root disk
  and a data disk of the rest (`image::data_disk_gib`; per tier in the table above);
  drift checks compare the root disk only.
  Subscription reconcile matches computer ids, never prices.
  `ComputerStatus` exposes `vcpus`, `memoryGib`, `diskGib`, `catalogEntry`.
  Read configured offers without billing through `ComputerService::catalog()`
  and `size_spec(size)`; omitted sizes return `ComputerError::SizeNotOffered`.
  The schema is one migration (`*_macro_computers.sql`, plus the concurrent
  harness index); a row with both or neither of a price and a comp reason is
  quarantined.
  `created_by` keeps the purchaser's id without a foreign key, so deleting the
  account is never blocked; harness deletion clears its reference.
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
  minutes; there is no lease heartbeat. Host agent request timeouts alone
  do not bound a composite effect. On cancellation, stop leasing, drain the
  current effect for up to thirty seconds, drop its future, then return only
  this batch's unfinished leases with their original deadline to `run_after =
  now`. Preserve recorded retry backoffs and replacement replicas' leases.
  Persist fleet completion, its lifecycle event, effects and timers atomically;
  preserve a macrod connection observed before creation completion.
  SIGKILL cannot release leases; replacements recover them at lease expiry.
  RPC cancellation does not cancel a host agent operation already accepted by
  the host (or a Docker daemon operation). Fleet create/start idempotence and
  idempotent crash recovery remain required; leases bound worker execution,
  not exactly-once execution of remote commands.
- **Fleet ownership**: Require explicit `COMPUTERS_CONTROL_PLANE_ID` whenever
  `COMPUTERS_FLEET` is `firecracker` or `docker`, shared across replicas but distinct per control plane.
  Stamp the Firecracker computer's `controlPlaneId` / Docker `macro.control_plane` at create;
  `Fleet::instances` lists only that owner's instances. Reconcile independently
  checks ownership and deletes orphans only after ten minutes. Creation timestamps
  are stamped once as `user.macro.created_at` / `macro.created_at`; missing or
  invalid timestamps prohibit orphan deletion. Never adopt unlabelled instances.
- **Capacity**: free sold units are sold capacity minus the units of live
  computers (phase not `destroying`) and every reservation, expired or not
  (an expired one may still settle as charged), reserved under
  the host lock. A size is only reserved on a host whose awake capacity
  fits it, so a sold computer can always be powered on somewhere.
  `GET /team/computers/offers`, computed from `ComputerRepo::allocation`,
  omits sizes no host can run awake (waiting would never make them
  available) and reports `soldOut` for the rest; a purchase no host can fit
  returns `ComputerError::SoldOut(size)` (409, "No capacity for <size> right
  now") before billing. `GET /team/computers/purchase-offers` lists the same
  sizes for the buy dialog (admins only: it names the card), each with
  `dueToday` (the prorated rest of the period a purchase invoices, less the
  customer's credit balance; 0 when comped), plus `renewsAt` and the `card`
  charged (brand and last four; `null` when comped or paid another way). It
  comes from `Billing::purchase_terms`: one expanded subscription read and one
  `invoices/upcoming/lines` preview for every size, never on the purchase
  path. `/offers` stays unchanged for clients that predate it. `allocation`
  reads the same holdings per host; see
  Observability for its gauges.
- **Overcommit** (`domain/overcommit.rs`, pure): each host row holds its
  settings (`cpu_allocation_percent`, `ram_allocation_percent`,
  `reserved_vcpus`, `reserved_memory_gib`, `oversell_factor`, the
  low/high/hard-ceiling memory watermarks, `start_resident_memory_mib`,
  `minimum_idle_seconds`, `memory_report_freshness_seconds`), so tuning a host
  is an `UPDATE`. Defaults were measured on an n2-standard-32 (6:1 vCPUs with
  the host agent weighting active computers' CPU, 4:1 memory, 2 vCPUs and
  16 GiB reserved, oversell 2, 70/80/90 %). Units (sales)
  are `min((vcpus - reserved) * cpu ratio / 4, (memory - reserved) * ram
  ratio / 8)`. A start or wake is admitted under the host lock only when the
  awake, unhibernated computers' vCPUs and memory fit the ratios **and** the
  host's memory report is fresh, under the high watermark and stays under the
  hard ceiling with the start, counting each start admitted since the report
  (`admitted_since_report`) at `start_resident_memory_mib`. A stale or missing
  report refuses (fail closed); the computer waits with the normal capacity
  backoff. Refusals log `host refused a start` and count
  `computer.overcommit.refusals{reason}`.
- **Relief and wakes**: the operator's overcommit pass (every 10 s, per
  host, span `computer.overcommit.host`) stores the host's report
  (`MemTotal - MemAvailable` from the host agent), hands the agent its
  limits (`memory.max` of the VMs' cgroup at the hard ceiling, and the zram
  squeeze window from the low to the high watermark), mirrors which
  guests are hibernated into `hosted_runtime.hibernated_at`, and above the
  high watermark hibernates the idlest guests until under the low one. Idle
  means under 10 % of a vCPU between passes for `minimum_idle`, and no agent
  session on the computer's harness with a turn under way or prompts queued
  (asked only under pressure). A hibernated computer stays `Running` to its
  team and counts against neither allocation nor live memory. It wakes when
  its team powers it on (`wake_requested_at`) or when a prompt finds its
  runtime absent (`computers/wake.rs` wraps the runtime connections, waits up
  to 20 s for macrod's dial, else the prompt stays queued until macrod dials).
  Wakes are admitted like starts and run through a per-host queue
  `max_concurrent_starts` wide; refused ones stay requested and the pass
  retries them, longest waiting first. The host agent does the rest on its
  own, inferring activity from each VM's CPU use: `cpu.weight` by activity
  (what makes the 6:1 vCPU default safe) and the zram squeeze of idle guests
  between the low and high watermarks, before relief hibernates anyone.
  Each setting, its default and how to change it on a live host:
  [computer overcommit runbook](../runbooks/computer-overcommit.md).
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
  `computer-add:{reservation id}`. The charge runs beside the guest's
  creation: the request takes the computer's billing guard, converts the
  reservation at once (`convert_reservation`: delete it, insert the computer
  in Provisioning with `Billing::Charging{extra_items, charger: Request}`,
  enqueue Create and a `ChargeUnsettled` timer at `CHARGE_TAKEOVER`, in one
  transaction; the fleet operator wakes on LISTEN and restores while Stripe
  invoices), then charges (span `computer.purchase.charge`) and answers only
  once the outcome is definite, so ready time is max(charge, restore). Success
  applies `ChargeSucceeded{item}` (`Active`) → `Ready` (200). A definite
  refusal applies `ChargeFailed{seen: ByBuyer}`: released (Destroy +
  RevokeHarness, `EndsAt{now}`, `Failure::Payment`, units freed), no setup
  notice, and the typed error (402 for a decline) whose caller undoes what it
  set up (team_agents' invite). An unknown outcome applies `ChargeUnsettled`
  (`charger: Worker`, `Effect::Charge`) → `Confirming` (202); the billing
  worker replays the same key and settles it for good on its last attempt
  (`settle_computer_add`), and a refusal found then is `ChargeFailed{seen:
  Later}`, which notifies `Failed{Payment}` and queues `UndoAgentInvite`. The
  takeover timer does the same for a request that died part way. While
  charging, cancel/undo/restore are `Rejected::PaymentPending` (409), an
  agent's credentials wait (`DeliverAgent` comes with `ChargeSucceeded` if
  macrod already connected), and subscription snapshots skip the computer. A
  release while charging (team release, team deletion, a second failed first
  start) queues `SettleCharge{landed: Remove | Refund}`, which waits on the
  billing guard, fences the add and removes (or refunds, then removes) an
  item that landed. A declined computer is released, so it is never listed;
  a retry of its purchase key answers `PaymentFailed` again, and one while
  charging `Confirming`. `confirm_reservations` (run by the billing worker)
  handles a reservation whose request never converted it: it replays the
  same idempotent update after `CONFIRM_DELAY` until expiry, then
  `settle_computer_add` abandons the change for good and converts only if the
  subscription carries an item with the computer's id; otherwise the
  reservation is deleted. An error shown to the buyer therefore always means
  nothing was charged. Status/list show a reservation as status `purchasing`
  (setup step `billing`), and a charging computer with billing `purchasing`;
  every request on a reservation is `ComputerError::NotPurchased` (409).
- **Billing**: cancel removes the item at once without proration (the period
  is paid) → `EndsAt{at = period end}` and a `BillingEnds` timer at `at` that
  stops the computer and starts retention (`RetentionExpired` at `at +
  retention` destroys it). Undo before `at` re-adds an item without proration;
  after `at` it is `Rejected::BillingEnded` and restore
  (`POST /team/computers/{id}/restore`) re-adds it prorated, keeping the
  stopped guest. Undo, restore, item removal and stray cleanup run under the
  computer's billing guard (`ComputerRepo::lock_billing`): undo/restore check
  the state under it, reuse an item still carrying the computer id (a removal
  not run yet, or an earlier unknown outcome), else add one keyed
  `{purpose}:{id}:{billing_changed_at}:{attempt}` (a key whose change
  definitely ended is skipped), apply the event, and remove the item again if
  the lifecycle refuses it. Release now removes the item and destroys.
  `RemoveBillingItem{item}` skips an item the computer is billed on again,
  keys its removal `computer-remove:{effect}:{generation}`, the same key on
  every retry (only a generation given up while its outcome was unknown moves
  to the next; one that applied ends the effect), treats an item or
  subscription (or team) already gone as removed and, after `MAX_BILLING_ATTEMPTS`, logs `computer billing item
  removal abandoned` (a Datadog monitor in `infra/stacks/monitoring`) and
  stops. `observe_subscription(team, SubscriptionObserved)` is the one billing
  owner for Stripe subscription events, fed by the Stripe inbox's
  `computers` consumer (`docs/architecture/stripe-event-inbox.md`) with each
  snapshot in order, its `observed_at` the event's time: items are matched by `computer_id`, never by price or
  count; a billed computer whose item is missing (or whose subscription
  ended) gets `BillingItemMissing` (ends billing now, retention); past
  due/unpaid/paused → `PaymentLapsed` (`PastDue`, the computer is turned off
  after the grace, never destroyed); paid again → `PaymentRecovered`. A
  snapshot read before a computer's `billing_changed_at` cannot change it.
  Items a computer is not billed on (duplicates, or items naming a canceled,
  released or unknown computer; never one naming a reservation) are removed;
  every computer is tried and the first error returned, so the inbox retries
  the snapshot. An undo or restore whose charge applied but whose
  event never did (a dropped request) is finished by reconcile from its item
  (`readd_charge`); a pending one is left for a later snapshot. The billing
  worker handles each effect on its own: a failure to read the computer is
  retried with backoff and counts toward the abandonment alert, and a
  quarantined computer's removal still runs. A purchase whose charge outcome
  could not be recorded answers `Confirming`, never an error.
  Items naming no known computer are logged, never mapped.
- **Team deletion**: `TeamComputerRelease::release_team` deletes the team's
  reservations first (one converting meanwhile is then listed as a computer;
  a deleted one never converts) and releases every live computer through the
  normal effects;
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
  JSON body only accepts `purchaseKey`, `size` and `name`. Offers also use
  policy. Computers are for paying teams:
  `Billing::require_paid_plan` refuses a trialing subscription with
  `BillingError::TeamOnTrial` (403, body `code: "team_on_trial"`) before a
  Stripe quote, offer, purchase reservation, undo or restore; comped
  purchases skip it. Funding always comes from `CompPolicy`. Comped purchases reject nonempty `extraItems` (`CompedExtraItems`), never call the
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
  A computer bought for an agent teammate (`ComputerAgents::agent_of`) gets no
  coding agent: it is the teammate's.
- **Agents go with the computer**: `Harnesses::revoke(&Computer)` (the
  `RevokeHarness` effect of release and retention expiry) deletes the harness,
  then every agent bound to it, inside the one effect. The harness delete locks
  its row `FOR UPDATE` and agent binds hold it `FOR SHARE`, so a concurrent
  bind is either deleted too or refused. `ComputerStatus.agentCount` counts the
  live agents on the computer's live harness, teammates' private ones included
  (`ComputerRepo::agent_counts`), for the release warning.
- **Guided setup**: `POST /team/computers/{computer_id}/setup-complete` →
  `ComputerStatus`, `ComputerService::complete_setup`, records
  `setupCompletedAt` once (idempotent). Allowed to the team's owner and admins
  (`AdminTeamRole`), as Claude sign-in is (owner access to the computer's
  harness, the web's `canManageClaude`); others get 403.
- **Status**: `ComputerService::list(team_id)` →
  `ComputerStatus` with `setup: Option<SetupProgress>` (Billing →
  Creating → Booting → Connecting → Ready, positions 1–5) until macrod first
  connects. A purchase being confirmed (its subscription change not settled,
  possibly waiting on another change in flight) reports status `purchasing`,
  step `billing` (1 of 5); a converted computer starts at Creating.
  Billing is `billing` (`purchasing`, `active`, `past_due`, `ending`,
  `ended`, `comped`) with `cancelsAt`, `canUndoCancel`, `retainedUntil`,
  `canRestore`, `pastDueSince` and `compReason`. Readable by any team member.
- **Retry/reprovision**: `ComputerService::retry(team_id, computer_id)` → `ComputerStatus`,
  exposed to team admins at `POST /team/computers/{computer_id}/retry`. Only
  computers that gave up (`Crashed` with no retry) can be retried; the
  lifecycle rejects others with `Rejected::NotFailed` (409).
  Applies `TeamRetry` (like `OperatorRetry`, but it sets
  `ComputerState::retried_by_team`, so a give-up before the computer next
  boots logs instead of paging; a boot clears it) and never touches billing
  or purchases. A typed missing
  fleet instance completes its effect and applies `InstanceLost`: recreate on the
  same host, computer row and harness id, starting only with power On and room.
  Reconcile also detects missing gave-up/Stopped guests; awake guests
  first follow crash/restart. Re-enrollment re-keys the harness. A lost guest
  whose billing ended becomes Destroying with a Destroy effect (so the fleet
  still deletes its data volume) and revokes its harness, without removing
  billing again. Missing stop/destroy are idempotent successes.
- **Reprovision**: `InstanceLost` recreates the guest from the fleet's
  configured image for it (the agent image for an agent computer) with a fresh pairing for the same harness, on the data
  disk the lost guest left (homes, Claude login and Docker data survive).
  The new enrollment generation makes `macrod enroll` run again: it claims
  the new pairing and replaces only the enrollment marker and credential.
- **Data disk**: every computer has one, created with the guest and deleted
  by `Fleet::destroy` with it. Firecracker: the host agent creates the
  computer's `/home` volume (`homeDiskGib`) beside its copy-on-write root disk
  and reuses one a lost guest left behind. The guest mounts it at `/home` and
  keeps `/var/lib/macrod` there. Docker: named
  volumes `macro-computer-<id>-home` (`/home`) and `-macrod`
  (`/var/lib/macrod`). Create and destroy are idempotent and leave no volume
  behind a destroyed computer: a retried Create reuses the volume an earlier
  attempt made.
- **Images**: images are versioned names (`macro-box/<version>` on Firecracker,
  `macro-box:<tag>` on Docker); `COMPUTERS_IMAGE` names the one new computers
  get, `COMPUTERS_AGENT_IMAGE` the agent-mode build of the same guest
  (`macro-box-agent/<version>`, `macro-box-agent:<tag>`) for agent teammates'
  computers. Both are required; there is no fallback to the regular image.
  Fleets hold them as `image::GuestImages` and pick with
  `GuestImages::for_enrollment`: the agent image when the enrollment carries
  an agent, so a recreated agent computer stays on it. An existing guest
  keeps the image it records. `hosted_runtime.image` records the image each computer was created
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
  is pure: within three days of the expiry harnessd last reported
  `ExpiresSoon`, within one day `ExpiresToday`, once passed `Expired`. Each
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
- **Setup notices**: `transition` emits `Effect::NotifySetup` when first setup
  ends: `Ready` on the first macrod connection (before `setup.connected_at`
  latches), `Failed` when a not-yet-connected computer gives up, once per
  attempt. The fleet worker sends it to the buyer (`created_by`) through the
  `SetupNotices` port as a `computer_setup` notification; a send that keeps
  failing is dropped after its retries and never fails the computer. For an
  agent teammate's computer the notice carries the agent (`agent_of`) and goes
  to the agent's inviter by the agent's name, but only when it failed: macrod
  connecting doesn't start the agent, so "<name> is ready" is sent by the auth
  service when the agent first reports online (`POST /team_agents/me/online`,
  `crates/team_agents/AGENTS.md`), under the same notification id.
- **Failed first start**: the first start lasts until setup completes and,
  for an agent teammate's computer, until the agent reports online
  (`awaiting_agent`; the report applies `AgentOnline`, and an
  `AgentStartDue` timer `AGENT_START_DEADLINE` (3 min) after macrod connects
  fails it with `Failure::AgentNotStarted`; a macrod that dials without the
  `apply-agent` in its `x-macro-runtime-accepts` dial header fails it at once
  with `Failure::AgentUnsupported`). A lost host is no strike: a
  host outage must not release every computer setting up on it. The first
  give-up in it waits for a team retry on the same computer, with no new charge,
  unless the agent then reports online after all, which recovers it. The second
  (`MAX_FIRST_START_FAILURES`) releases the computer (`EndsAt{now}`, Destroy,
  RevokeHarness), queues `RefundPurchase` and `UndoAgentInvite`, and notifies
  `SetupOutcome::Released` (a `computer_setup` `Failed` notice with
  `released`). The billing worker credit notes the purchase's invoice lines
  (the computer's own price) under `computer-refund:{computer id}`,
  refunding what the card paid and crediting back what the team's balance
  paid, records the credit note and refund on the computer
  (`PurchaseRefunded`), then removes the item without proration. The agents
  worker (authentication_service, team_agents as `AgentInvites`) takes the
  agent back: keys, repository, membership and seat; the account stays.
- **Gateway**: computers call Claude via `ANTHROPIC_BASE_URL=<agent harness service>/anthropic`
  with a per-session token; see `services/agent_harness_service/AGENTS.md`.

### Agent teammate computers

`ComputerService::purchase_for_agent` is `purchase_for_team` with the computer
linked to an agent account (`hosted_runtime.agent_user_id`, one computer per
agent); `ComputerAgents` reads the link. hosted_runtimes knows nothing else about
the agent: its enrollment names only `role: agent` (`ComputerRole`, which
picks the guest image and what the guest grants its user) and carries no
credential. When macrod connects while the agent hasn't reported online, the
lifecycle queues `Effect::DeliverAgent` (and the `AgentStartDue` deadline);
the operator publishes `{harness, computer, generation}` (plus trace context)
on the runtime bus via `Harnesses::deliver_agent`, and only the replica
holding macrod's socket issues the agent's environment through its
`AgentEnrollmentSource` (team_agents' `issue_enrollment`, which rotates the
agent's key) and sends it down that socket as `ToRuntimeMessage::ApplyAgent`,
with the setup `traceparent` the agent's start joins.
Each macrod connection hands it over again until the agent reports online.
team_agents reads an agent computer's roster state with
`ComputerService::status_for_roster` (answered on a detached fleet too) and
releases it with `request_release` when the agent is removed: normal release
effects, no fleet access or name confirmation, team ownership still checked.

An agent teammate is a member people reach by message, so nothing else runs on
its computer. `PgComputerAgents` (the `ComputerAgents` reads on their own)
implements harnesses' `ComputerTeamAgents`: the harness listings and a patch's
answer carry `team_agent_user_id` on the computer's harness, and
`HarnessTeamAgents::harness_team_agent` answers for one harness. Saved agents
(bots create/update/patch) and session opens (`persona_for_owner`, and a
runtime's external create) refuse such a harness with 409 "This computer
belongs to an agent teammate. Message them instead." The harness stays in
`GET /harnesses`, where Connect Claude plan finds it by `computer_id`; the web app's
runtime lists read `useRunnableHarnessesQuery` /
`useRunnableHarnessDirectoryQuery`, which drop it.

## Typed boundaries

- Use shared `computer_id::ComputerId`, `pairing_id::PairingId` (re-exported by `domain::ids`), `domain::ids::HostId` and `harness_id::HarnessId`; keep team IDs as UUIDs until a shared team identity exists. Convert only at external/storage boundaries.
- Pass `MacroUserIdStr<'static>` through domain models, ports and services; parse inbound strings and stored buyers at their adapter boundaries. Keep wire fields as strings.
- Construct `ComputerName` to trim and validate display names. `DeviceSecret` redacts Debug/Display and zeroizes on drop; expose only for pairing or enrollment transport. It deliberately has no Serialize implementation.
- Keep serde newtypes transparent and validate string deserialization through `TryFrom<String>`; serde does not allow `transparent` together with its `try_from` container attribute.

## Operational notes

- Preserve undecodable rows as `ComputerRecord::NeedsAttention` with row id, team,
  host and a static field-and-rule reason; never include parser errors or stored
  values in quarantine logs. Keep their ids in expected instances and treat
  quarantine as present in orphan checks. Only validated computers receive
  lifecycle events or have fleet effects/timers selected (billing item removals
  still run, since they only stop a charge); repair resumes pending work.
  Retain raw purchase metadata for display only; quarantine reports null payment.

- DockerFleet enforces recorded vCPU and memory limits through cgroups without
  CPU pinning; dev-only Docker guests still see host totals in `/proc` and
  `nproc`. Do not add lxcfs; Firecracker guests see their real CPU and memory limits.

- Lifecycle state stores the phase tag at `state.phase.phase` and the billing
  tag at `state.billing.billing`; SQL selectors must read those nested tags.
  Size, effect worker, timer kind, notice stage and provider are Postgres
  enums mapped with `sqlx::Type` (`ComputerSize`, the adapter's
  `OutboxWorker`, `TimerKind`, `ClaudeSignInStage`, `AgentProvider`).
- A deployed control plane drives every Firecracker host: each
  `hosted_runtime_host` row with an `endpoint` and pinned
  `server_certificate_pem` gets its own `FirecrackerFleet` (`HostFleets`),
  registered (its capacity and heartbeat) on every reconcile pass. A local
  stack drives one Docker home host its environment configures. The operator
  leases fleet effects and fires timers only for computers on the hosts it
  drives (`ports::HostScope::Only`); billing serves every host
  (`HostScope::Every`). Each host runs its effects in lease order,
  `max_concurrent_starts` (default 1) at a time.
- `hosted_runtime_host.admitting` (default true): purchases are placed only on
  admitting hosts, and `allocation` (offers, capacity gauges) counts only
  those, so turning it off drains a host of new purchases.
- Shared hosts require distinct `COMPUTERS_CONTROL_PLANE_ID` per control plane;
  only owned instances are reconciled. Local stacks use `local-<instance>`.
- Scope Docker fleet listing to both its configured network and control-plane
  label; never reconcile foreign or unlabelled guests on shared hosts.
- A purchase whose charge cannot be settled at expiry logs `computer payment
  unresolved` at error level and keeps its reservation for the next pass.

## Observability

One computer's first setup is one trace, rooted at the purchase (Buy computer). See the [setup trace runbook](../runbooks/computer-setup-traces.md).

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
  tracer: `computer.setup.payment` (reservation → charge settled or comp;
  it overlaps the next waits), `computer.setup.create` (conversion → guest
  booting, including outbox and capacity waits), `computer.setup.boot` (→ first macrod connection) and the total
  `computer.setup`; for an agent teammate also `computer.setup.agent_handoff`
  (→ macrod took the agent, `Event::AgentDelivered` from the finished hand-off) and `computer.setup.agent_start` (→ the agent
  online). Work parents under the purchase for the whole first start
  (`ComputerState::first_start`), so the hand-off joins the setup trace. They carry `computer_id`, `team_id`, `size`, `host_id`,
  `generation`, `billing_kind` and `capacity_waited`. A rolled-back
  transaction can export a wait that a retry exports again.
- `Enrollment.traceparent` carries the setup context to macrod; see
  `crates/coding_agent_worker/AGENTS.md`.
- Fleet work and billing work emit one span per claimed effect, with errors
  marked even when retry scheduling succeeds.
- Metrics: `computer.setup.phase.duration` (seconds, by `phase`),
  `computer.setup.duration` (reservation → first macrod connection),
  `computer.provisioning.duration` (the same total, unlabelled),
  `computer.effect.failures` (by phase) and `computer.firecracker.reachable`
  (0/1, by `host` and `url.template`).
- Capacity gauges, every reconcile pass: `computer.capacity.allocated` and
  `computer.capacity.total` by `scope` (`host`/`fleet`), `host_id`, `host`
  and `resource` (`sold_units`, `vcpus`, `memory_gib`, `disk_gib`). Only
  units have a total; hosts record no disk capacity. Read by
  `infra/stacks/monitoring/monitors/computer-capacity.ts`; see the
  [capacity runbook](../runbooks/computer-capacity.md).
- Usage shown to teams (Settings → Machines, CPU and memory over the last
  day): the overcommit pass keeps one reading per running computer per
  minute from the host's cgroup numbers, span `computer.usage.record`
  (`samples`, `kept`) under `computer.overcommit.host`; `computer.usage.prune`
  (`deleted`) every ten minutes; `computer.usage.read` (`computers`,
  `samples`) under `GET /team/computers/usage`. No guest agent is involved,
  and metrics carry no computer ids. Operators read per-computer series in
  Grafana instead (see [Firecracker computers](firecracker-computers.md#hosts)).
- Overcommit, every overcommit pass, by `host_id` and `host`:
  `computer.host.memory.{used,low_watermark,high_watermark,hard_ceiling}_ratio`
  (shares of host memory, so monitors compare usage with each host's own
  limits) and `computer.host.memory.report_age` (s); counters
  `computer.overcommit.refusals{reason}`,
  `computer.overcommit.hibernations{outcome}` and
  `computer.overcommit.wakes{reason, outcome}`. Spans:
  `computer.overcommit.{pass,host,hibernate,wake,wake_queue,wake_request,dispatch_wake}`
  and `computer.wake_for_prompt` in agent_harness_service.
