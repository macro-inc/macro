# agent_git_service

## What it is

Composition root for `crates/agent_git`: hosts each agent's workspace repo
(smart HTTP) and the internal create/delete API. Gateway prefix `/agent-git`;
`AgentGitServiceUrl` in `macro_service_urls`.

## Scope

- Callers: agent provisioning (`crates/team_agents`, via
  `agent_git::client::AgentGitClient`), the brain on a Macro computer
  (clone/push with its repo token), and team admins (clone).
- Config (`src/config.rs`, Doppler `agent-git-service`): `DATABASE_URL`,
  `INTERNAL_API_KEY`, `REPO_STORAGE_ROOT`, `MAX_REPO_SIZE_BYTES` (default
  500 MiB), `PUSHES_PER_MINUTE` (default 30), `ENVIRONMENT`.

## Checks

- `TMPDIR=/home/wolf/tmp cargo test -p agent_git -p agent_git_service`
- `cargo run --bin agent_git_service_doppler_config` validates Doppler (CI).

## Gotchas

- The image needs `git` (`git http-backend`); `REPO_STORAGE_ROOT` must exist
  (EFS in AWS, the `agent-git-repos` docker volume locally) or startup fails.
- Run a single task: the push rate limiter is in memory.
- No compression layer: pack bodies are already compressed and streamed.
