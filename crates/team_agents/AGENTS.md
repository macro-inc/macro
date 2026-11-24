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

## Start here

- `src/domain/service.rs`: invite, list, remove and enrollment issuance.
- `src/domain/ports.rs`: what the service needs from other crates.
- `src/domain/admission.rs`: agent admission for the vault.

## Scope

- Owns: agent accounts, the `team_agents` table, enrollment issuance.
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
