# agent_git_service

## What it is

Composition root for `crates/agent_git`: hosts each agent's workspace repo
(smart HTTP) and the internal create/ensure/delete API. Gateway prefix `/agent-git`;
`AgentGitServiceUrl` in `macro_service_urls`.

## Scope

- Callers: agent provisioning (`crates/team_agents`, via
  `agent_git::client::AgentGitClient`), the brain on a Macro computer
  (clone/push with its repo token), and team admins (clone).
- Config (`src/config.rs`, Doppler `agent-git-service`): `DATABASE_URL`,
  `INTERNAL_API_KEY`, `REPO_STORAGE_ROOT`, `MAX_REPO_SIZE_BYTES`,
  `PUSHES_PER_MINUTE`, `ENVIRONMENT`. Every value is required; there are no
  deployment defaults. Local boot fixtures explicitly use 500 MiB and 30
  pushes per minute. Populate service Doppler `dev`/`prd` and
  `local/lcl_personal` before rollout; ECS environment entries do not override
  `APP_SECRETS_JSON`.

## Checks

- `TMPDIR=/home/wolf/tmp cargo test -p agent_git -p agent_git_service`
- `cargo run --bin agent_git_service_doppler_config` validates Doppler (CI).

## Gotchas

- Startup checks `git --version` and the `git-http-backend` executable before
  opening the health listener, failing loudly if the image lacks either.
- The image needs `git` (`git http-backend`); `REPO_STORAGE_ROOT` must exist
  (EFS in AWS, the `agent-git-repos` docker volume locally) or startup fails.
- Run a single task: the push rate limiter is in memory.
- No compression layer: pack bodies are already compressed and streamed.

- Internal create/ensure exchanges validated `RepoToken` strings; malformed
  bootstrap credentials are rejected before repository mutations. Credential
  and hash Debug output stays redacted in the shared `agent_credentials` crate.
- Recovery uses `POST /internal/repos/ensure` with the saved bootstrap token;
  repeating `POST /internal/repos` intentionally re-keys a repo.

HTTP tracing adopts incoming W3C context through
`macro_tower_layers::MakeSpanWithRemoteParent`, including internal repo calls.
