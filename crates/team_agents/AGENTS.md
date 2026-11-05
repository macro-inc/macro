# team_agents

## What it is

Agent teammates (docs/design/agent-brains.md): AI teammates that are real
Macro accounts on a team, each on its own Macro computer. This crate invites
one and buys its computer in one step, and serves the agent's own profile and
email over `/team_agents` in the auth service.

## How it works

`POST /team_agents` (team admins, `enable-team-agents`) → validate → mailbox
→ account rows + `team_agents` row (one transaction, `"User"."isAgent"`) →
`TeamService::add_team_agent` (joins without a Stripe call; returns the seat
item) → user API key → workspace repo (`agent_git`) → `Computers::purchase`
with the persona and the seat item, so seat and computer share one Stripe
update. The purchase is the commit point: any earlier failure undoes the
repo, membership, account and mailbox; after it the agent exists and its
`status` (`provisioning` → `running` | `failed`) is refreshed from the
computer on `GET /team_agents` and `GET /team_agents/me`.

`GET /team_agents/quote?size=` includes `vcpus`, `memoryGb`, and `diskGb`
from the hosted-runtimes size catalog alongside the seat and computer price.

## Start here

- `src/domain/service.rs`: the create flow, undo, delete, and the persona
  (`config_keys` lists the config drive values the brain reads).
- `src/domain/ports.rs`: the `Computers` and `AgentRepos` contracts.

## Scope

- Owns: the `team_agents` table, agent account creation and deletion, the
  persona sent to the computer, agent email.
- Not here: membership and seat pricing → `crates/teams`; computers →
  `crates/hosted_runtimes`; repos → `crates/agent_git`; secrets →
  `crates/agent_secrets` (this crate implements its `TeamAgentDirectory`).

## Checks

- `cargo test -p team_agents --all-features` (`SQLX_OFFLINE` unset).

## Gotchas

- The config file `/etc/macro/personas/<os_user>.env` holds the bootstrap
  credentials: `MACRO_API_KEY` and the repo-scoped `MACRO_REPO_TOKEN`. Write
  it with mode 600, owned by `os_user`. Every other secret goes through
  `agent_secrets`, fetched per use.
- Run `/opt/macro/brain run` as the name-derived OS user, with `MACRO_GATEWAY`,
  `BRAIN_WORKSPACE=/home/<os_user>/workspace`, `BRAIN_HEALTH_PORT=7801`,
  `MACRO_REPO_URL`, `MACRO_REPO_TOKEN`, `MACRO_AGENT_USER_ID`, and `MACRO_API_KEY`
  in the persona config.
- `outbound/hosted_runtimes_computers.rs` calls `ComputerService` in process;
  its purchase forwards the persona and seat in `extra_items` for one Stripe
  update. Tests keep the fake `Computers` port. The persona (name, job,
  personality) is written into the repo's `OPERATING.md` by `agent_git`.
- Quote and purchase report billing-provider outages as 502, without exposing
  provider details in the response.
- Delete runs computer → repo → seat → mailbox → account; the row goes last
  so a retry after a partial failure still finds the agent.
- Without `DEAD_SIMPLE_MAIL_API_KEY` agents get an `@agents.macro.invalid`
  placeholder address and the email routes answer 503.
- The brain reaches Macro through `ApiGatewayUrl` (a local stack overrides it
  to its proxy), never the auth container's in-network service URLs.

## Related

- Rules: `.agents/rules/rust/security.md` · Docs: `docs/design/agent-brains.md`

## Provisioning recovery

`POST /team_agents/{agent_user_id}/retry` requires a team admin receipt and checks
that the agent belongs to that team. Non-failed computers return their current
agent unchanged. Failed computers reuse the saved computer ID, persona bootstrap
credentials, and `team_agents.persona_seed`; recovery never buys another computer,
adds a seat, creates an account, or mints an API key. Repo recovery calls the git
service's `ensure` API, which preserves live tokens and repo contents. A missing
repo is reseeded, not restored from deleted history. Older rows with no saved seed
or computer return 409. Retry errors leave the agent available for another attempt.

The outbound adapter currently has an explicit TODO until the owning computer
service exposes `ComputerService::retry(team_id, computer_id)`; it returns 409
instead of silently purchasing again. Bootstrap credentials remain in the existing
computer persona; the new seed column contains only the original name, job and
personality.
