# agent_credentials

## What it is

Validated bootstrap credentials shared by agent git, team-agent provisioning and
the standalone brain gateway, and the agent teammates rollout for agent accounts. Repo tokens keep the existing `mrt_` + 64 hex format;
agent API keys accept the existing user API key format after validating `mak_` + 64 hex.

## Boundaries

No HTTP or authorization. Parse strings at ingress and storage reads;
use `expose` only for credentials or persona configuration. Possessing a valid
shape grants no access: the owning service still verifies hashes and ownership.

`rollout` is the one place an agent's own calls check `enable-agent-teammates`:
`agent_teammates_enabled` evaluates it for the agent's creator through the
`AgentCreators` port (fail closed). Its only persistence is `PgAgentCreators`
(`postgres` feature), one read of `team_agents.created_by`, falling back to the
team's `owner_id` when the creator's account is gone; `FakeAgentCreators` is
for tests. Wired by agent_harness_service and authentication_service.

## Checks

- `cargo test -p agent_credentials --features postgres` (`SQLX_OFFLINE` unset).
- `cargo clippy -p agent_credentials --all-features --all-targets -- -D warnings`.

## Gotchas

- Keys and repo-token plaintext use zeroizing storage on drop.
- Debug must redact keys and hashes. Equality of fixed-length secrets and digests
  uses `constant_time_eq`, including ordinary `==`.
- Serde validates on input and preserves plain JSON strings. No unchecked parser.

## Related

- `crates/agent_git`, `crates/team_agents`, `crates/user_api_key`.
