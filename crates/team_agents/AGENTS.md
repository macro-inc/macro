# team_agents

## What it is

Agent teammates: AI members of a team, each a real Macro account with its own
Macro computer and workspace repository, behind the `enable-agent-teammates`
PostHog flag. Served at `/team_agents` in authentication_service.

## How it works

`POST /team_agents` (team admin, own credential) → flag check (fails closed) →
`validate` parses the request into a `TeamAgentInvite` (`AgentName`,
hosted_runtimes' `PurchaseKey`, profile and avatar checks), so a bad field is a
400 before anything is created →
account rows + `team_agents` row in one transaction (`"User"."isAgent"`, a
placeholder `@agents.macro.invalid` address, no sign-in) →
`TeamService::add_team_agent` (included seat, no Stripe change) → workspace
repo on agent_git (served by agent_harness_service) → `ComputerService::purchase_for_agent`, the normal
per-computer purchase with the computer linked to the agent
(`hosted_runtime.agent_user_id`). A failure before the purchase completes
undoes the repo, membership and account, newest first; the charge is part of
the purchase, so a declined card leaves nothing behind. If the computer then
fails its first start twice (its agent's online report counts, see below),
hosted_runtimes releases and refunds it and calls `undo_invite` (the
`AgentInvites` port), which takes the agent back as removing it does, with no
admin: keys, repo, membership (`TeamService::take_back_team_agent`, in its
inviter's name) and seat, last. The account stays. The name is the only
required profile field: an invite without a job description and personality
seeds no identity, and the agent's first message asks what to take on.

The invite is idempotent on its `purchaseKey` (one per Invite dialog):
`team_agents` is unique on `(team_id, purchase_key)`, so a double click or a
retry after a lost answer creates nothing and answers with the first agent once
its computer is bought (a purchase still confirming counts). Before that the
first request may still take the agent back, so the repeat is a 409
(`InviteInProgress`). Only the request that created the account undoes it.

An agent's credentials never ride in the computer's enrollment, which only
names its role. Once the agent's macrod connects, the replica of
agent_harness_service holding its socket calls the internal
`POST /internal/team_agent_enrollment/{computer}/{generation}`;
`issue_enrollment` mints a fresh API key (`replace_key`, which revokes the one
it supersedes) and repo token and returns them with the computer-facing
addresses, and that replica sends them down macrod's socket
(`ToRuntimeMessage::ApplyAgent`). macrod stages them for the guest, which
installs `/var/lib/macrod/agent.env` and starts the agent.

An agent's call voice lives in its repo as `config/voice.json`, not here. The
invite's optional `voice` seeds it (`PersonaSeed.voice`; none keeps the starter
agent's default). `GET`/`PUT /team_agents/{agent_user_id}/voice` (team admin,
flag) read and commit it through agent_git; the agent's next call uses it.
`domain::voice::Voices` serves the provider catalog and spoken samples to team
admins behind the same flag; agent_harness_service implements its
`VoiceProvider` and mounts it at `/voices`.

The invite accepts `avatarFace` and `avatarUrl`. Owners and admins can replace
them with `PUT /team_agents/{agent_user_id}/avatar` (`{face, url}`, 204), behind
the same flag. Saving a face writes its recipe and PNG URL together; a missing
URL clears the old PNG. A URL must be a Macro static file,
`<StaticFilePublicUrl>/file/<uuid>` (`PictureBase`), on invite and edit, so
clients never load a host an admin chose. Saving a photo clears the recipe. Picture changes
publish through the `AgentPictureChanges` port after persistence.

`domain::admission::AgentAdmission::admit(agent, team)` answers whether an
account is an agent the vault may admit, from current facts each call: its
`team_agents` row is for that team, `"User"."isAgent"` is set, it is still a
`team_user` member, its `created_by` is a human, and a computer that isn't
released runs it (`ComputerAgents::has_live_computer`, one read on the pool; a
purchase still confirming doesn't count). It returns the responsible human, a
typed `NotAdmitted` reason, or `Unavailable` when any dependency fails (fail
closed). `resolve(agent)` admits an account to its own team, for the vault's
`AgentDirectory`, whose adapter lives in document_storage_service's outbound.

An agent's status comes from its computer (`provisioning`, `paused`,
`unhealthy`, `failed`, `released`), except that an up computer is `starting`
until the agent first reports itself online and `running` after. An agent
with no computer yet is `provisioning` for `ORPHANED_INVITE_AFTER` (10
minutes) after its account was made, then `failed`: the invite that should
have bought it died. The agent reports with
its own API key: `POST /team_agents/me/online` (the starter agent calls it once
per run when its presence socket opens) stamps `team_agents.first_online_at`
once. Every report first tells the computer
(`ComputerService::agent_online`, idempotent), which ends its first start and
records its setup complete, so a computer that missed the first report catches
up on the next. The first
report sends the inviter the computer's `computer_setup`
ready notice (same notification id as the operator's, so an older operator's
send dedupes). `outbound/setup_notices.rs` (`IngressSetupNotices`) builds that
notification for both senders: the auth service's `AgentReadyNotices` and the
computer operator's `SetupNotices` in agent_harness_service, which sends nothing
on macrod connect for an agent's computer unless the agent already counts as
online (one invited before reports, backfilled; its workspace never reports). Not tied to the starter agent: any
agent runtime reports the same way.

### On the owner's own machine

Behind `enable-self-hosted-teammates` (acting admin, fail closed) on top of
`enable-agent-teammates`. `POST /team_agents` with
`computer: {kind: "own", harnessId}` (a request with only `size` still buys
a computer; both is a 400) checks the machine (`self_hosting::HostEligibility`:
the admin's own paired harness, never a Macro computer; connected; latest
`TeammateHost` report has an engine, no problem, an image for its
architecture and the hardware floor), then makes the account, seat and repo
as above and a `team_agent_installs` row (generation 1) instead of a
purchase, and tells agent_harness_service (`TeammateRuntimes`, internal
`POST /internal/teammates/{harness}/changed`). `GET /team_agents/hosts` lists
the admin's machines with eligibility and each installed engine (`engines`,
with whether it can confine a teammate's network). Status comes from the install's
`run_state` (`downloading` is new) and `first_online_at`; a `failed` or
`rolled_back` install also answers `installProblem` (`{kind: failed |
rolledBack, reason}`, the machine's `InstallFailure`), absent during a move or
removal.

Delivery is counted: the replica holding the machine's socket asks
`POST /internal/team_agent_install/{harness}/{install}` with what the runtime
runs; `issue_install` bumps `delivery` only when the runtime is behind the
row (`PgTeammateInstalls::next_delivery`, a conditional update whose row lock
is held until the `CountedDelivery` is released), mints under that lock so
racing replicas mint in delivery order (`replace_key`, same brain key name),
releases (kept even when minting failed, so the runtime stays behind and gets
the next delivery) and returns the image
(`TeammateRuntimeImage::images`, a per-architecture constant; a local
stack may override it with `OVERRIDE_TEAMMATE_RUNTIME_IMAGE_{AMD64,ARM64}` =
`<repository>@sha256:<hex>`, ignored outside `ENVIRONMENT=local`; each
service reads them once at startup with `maybe_env_vars!` and injects the
result) and the
environment with public addresses (`MACRO_TEAMMATE_INSTALL_ID`, no
`MACRO_COMPUTER_ID`; on a local stack, the in-network `OVERRIDE_*` addresses a
local Macro computer gets, since the teammate joins the stack's network). A move (`POST /team_agents/{agent}/install`) or removal
first marks the row's `checkpoint`; the old machine stops the agent (its last
push), then `finish_checkpoint` (internal `.../{install}/checkpointed`, or at
once when the machine is offline, or after `CHECKPOINT_TIMEOUT`) makes a new
install id and generation on the target, or revokes and removes the agent
with its install last. While a move's checkpoint is open the agent lists as
`moving` with `movingTo` set to the target (`harnessId` is still the old
machine, which only saves its memory). A finished move sets `revoke_pending`: nothing is
delivered until the old machine's keys and repository token are revoked. A
revoke runs under `begin_revoke`, which locks the row and rechecks
`revoke_pending` (`SELECT … AND revoke_pending FOR UPDATE`) and clears it in
the same transaction (`HeldRevoke::done`), so a sweep holding a stale copy of
the row skips it instead of voiding the key the new machine was minted since.
Each agent's revoke under the lock is bounded by `REVOKE_TIMEOUT` (5 s); past
it the transaction rolls back and `revoke_pending` stays for the sweep. Only the agent's inviter or
the current machine's owner may move it. A machine whose owner is no longer
an owner or admin of the agent's team, or that was unpaired, gets nothing more
(`issue_install` checks `host_entitled`), and its agents are parked: at once
by `InstallOffboarding::offboard_unentitled` when the team service reports a
removal or demotion (`teams::domain::member_access`), and by the internal
`POST /internal/teammate_hosts/{harness_id}/offboard` (`offboard_host`, only
that machine's installs) that document_storage_service calls after an unpair
(`harnesses::domain::retired`, a 10 s client timeout). `offboard_host` parks
every agent on (or moving to) the machine first, then revokes while telling
it and the machine a parked mid-move agent was leaving (which still runs it;
the nudges are hints and never delay a revoke), so a slow revoke or the caller giving up leaves the rest parked, the
slow one `revoke_pending`; authentication_service's 60 s
sweep (`offboard_unentitled_hosts`) backs both. The sweep, the removal and
demotion hook and an unpair offboard and
revokes `OFFBOARD_CONCURRENCY` (4) agents at once, each within its 5 s, so
one hanging revoke costs a round one budget, not one per agent; a revoke that
failed in a round waits for the next. Parking: `park` waits for a
delivery in flight and sets `parked_at` and `revoke_pending`, then the
credentials are revoked; `installs_on` leaves a parked install out, so its
machine stops it. A parked agent keeps its account, seat, DMs and repository,
lists as `paused` with `installProblem: hostRemoved`, and may be moved (to a
machine of the mover's, or back to the same one) only by its inviter, the
team's owner (`owns_team`), or the owner of the machine it was parked off once
`host_entitled` again; never by another admin, who could otherwise park it by
removing its host and take its key, DMs and shares. The same sweep
retries every revoke still pending. Deleting a team first runs
`InstallOffboarding::release_team` (team deletion's
`release_teammate_installs`): park, revoke, delete each install, nudge its
machine; `team_agent_installs.team_id` and `harness_id` are `ON DELETE
RESTRICT`, so nothing drops an install with live credentials. No billing (`SELF_HOSTED_TEAMMATE_PRICING` is `None`).
Spec: `docs/design/teammate-runtime.md`.

## Start here

- `src/domain/service.rs`: invite, list, remove and enrollment issuance.
- `src/domain/ports.rs`: what the service needs from other crates.
- `src/domain/admission.rs`: agent admission for the vault.
- `src/domain/self_hosting.rs`, `src/domain/service/self_hosted.rs`,
  `src/outbound/pg_teammate_installs.rs`: agents on owners' own machines.

## Scope

- Owns: agent accounts, the `team_agents`, `team_agent_installs` and
  `harness_teammate_hosts` tables, enrollment and install issuance.
- Not here: the computer lifecycle and billing → `crates/hosted_runtimes`;
  membership and seats → `crates/teams`; the repo server → `crates/agent_git`;
  the agent runtime → `packages/muppet` and its template `packages/starter-agent`.

## Checks

- `cargo test -p team_agents --all-features`

## Gotchas

- `POST /team_agents` refuses an agent's program (`macro_authorization::is_program_run`, 403): creating one adds a team member, mints its key and buys a computer. A person adds one in Settings, Agents.
- The flag is a rollout gate, never authorization; team roles come from the
  receipt. Admin requests check the acting admin; enrollment checks the
  agent's creator (`agent_credentials::agent_teammates_enabled`), because
  PostHog targeting never matches an agent's own account.
- Never log or trace the agent's user id: it carries an email. Use
  `agent_credentials::telemetry_id`.
- Each enrollment rotates the agent's API key and repo token, so a lost
  earlier guest can no longer act as the agent.

## Related

- Rules: `.agents/rules/rust/architecture.md` · Docs: `docs/design/agent-teammates.md`
