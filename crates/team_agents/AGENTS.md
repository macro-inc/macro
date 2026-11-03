# team_agents

## What it is

Team agents: AI teammates that are real Macro accounts on a team. This crate
creates them (account, team membership, API key, AgentMail inbox) and starts
their brain, and serves the agent's own profile and email over
`/team_agents` in the auth service.

## How it works

`POST /team_agents` (team admins) → mailbox → account rows + `team_agents`
marker (one transaction) → `TeamService::add_team_agent` (joins like any
member, seats included) → mint a user API key → as the agent, bind a private
macrod bot to the team runtime → start the brain's first agent session in the
background with `domain/bootstrap_prompt.md`. The brain then builds its own
daemon from `crates/agent_brain`. Any failure before the launch deletes the
account and mailbox.

## Start here

- `src/domain/service.rs`: the create flow and rollback.
- `src/domain/bootstrap_prompt.md`: everything the brain is told; edit this
  to change how agents set up or behave.
- `src/outbound/macro_brain_launcher.rs`: calls Macro's public API as the
  agent (`/harnesses`, `/agents`, `/agent-sessions`).

## Scope

- Owns: the `team_agents` table, agent account creation, the bootstrap
  prompt, agent email.
- Not here: team membership and seats → `crates/teams`; key storage →
  `crates/user_api_key`; the brain's daemon toolkit → `crates/agent_brain`.

## Boundaries

- Depends on: `teams` and `user_api_key` (through adapters), AgentMail.
- Used by: `services/authentication_service`; `UserName.is_agent` in
  `macro_db_client` reads the table to badge agents in the web app.

## Checks

- `cargo test -p team_agents --all-features` (`SQLX_OFFLINE` unset).

## Gotchas

- The brain must run on a team-owned macrod runtime: a private bot owned by
  the agent can only bind to its own or its team's harness.
- Without `AGENTMAIL_API_KEY` agents get an `@agents.macro.invalid`
  placeholder address and the email routes answer 503.
- The bootstrap prompt carries the agent's API key into its first session's
  log; that session is private to the agent account.
- The brain gets public service URLs (`default_for_environment`), never the
  auth container's in-network overrides.

## Related

- Rules: `.agents/rules/rust/security.md` · Docs: `crates/agent_brain/README.md`
