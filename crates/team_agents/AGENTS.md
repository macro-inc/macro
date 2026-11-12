# team_agents

## What it is

Agent teammates: AI members of a team, each a real Macro account with its own
Macro computer and workspace repository, behind the `enable-agent-teammates`
PostHog flag. Served at `/team_agents` in authentication_service.

## How it works

`POST /team_agents` (team admin, own credential) → flag check (fails closed) →
account rows + `team_agents` row in one transaction (`"User"."isAgent"`, a
placeholder `@agents.macro.invalid` address, no sign-in) →
`TeamService::add_team_agent` (included seat, no Stripe change) → workspace
repo on agent_git (served by agent_harness_service) → `ComputerService::purchase_for_agent`, the normal
per-computer purchase with the computer linked to the agent
(`hosted_runtime.agent_user_id`). A failure before the purchase completes
undoes the repo, membership and account, newest first.

When the computer operator creates the guest it calls the internal
`POST /internal/team_agent_enrollment/{computer}/{generation}`; for an agent
computer, `issue_enrollment` mints a fresh API key and repo token and returns
them with the computer-facing addresses. macrod writes them to
`/var/lib/macrod/agent.env`, which the guest's `macro-brain.service` reads.

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
released runs it (`Computers::computer_for_agent` + `state`; a purchase still
confirming doesn't count). It returns the responsible human, a typed
`NotAdmitted` reason, or `Unavailable` when any dependency fails (fail
closed). The vault's `AgentDirectory` adapter is a thin impl over it.

An agent's status comes from its computer (`provisioning`, `running`,
`paused`, `failed`, `released`); nothing about it is stored here.

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

- The flag is a rollout gate, never authorization; team roles come from the
  receipt.
- Never log or trace the agent's user id: it carries an email. Use
  `agent_credentials::telemetry_id`.
- Each enrollment rotates the agent's API key and repo token, so a lost
  earlier guest can no longer act as the agent.

## Related

- Rules: `.agents/rules/rust/architecture.md` · Docs: `docs/design/agent-teammates.md`
