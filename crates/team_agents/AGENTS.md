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

- The config drive carries one Macro credential, `MACRO_API_KEY`, which
  bootstraps auth, plus `MACRO_REPO_TOKEN`, scoped to the agent's own repo.
  Every other secret goes through `agent_secrets`, fetched per use.
- `outbound/hosted_runtimes_computers.rs` is a placeholder until PR A's
  purchase API lands: every call answers 409, so creates stop before any
  charge. The persona (name, job, personality) is written into the repo's
  `OPERATING.md` by `agent_git`, not stored here.
- Delete runs computer → repo → seat → mailbox → account; the row goes last
  so a retry after a partial failure still finds the agent.
- Without `DEAD_SIMPLE_MAIL_API_KEY` agents get an `@agents.macro.invalid`
  placeholder address and the email routes answer 503.
- The brain reaches Macro through `ApiGatewayUrl` (a local stack overrides it
  to its proxy), never the auth container's in-network service URLs.

## Related

- Rules: `.agents/rules/rust/security.md` · Docs: `docs/design/agent-brains.md`
