# agent_git

## What it is

Agent teammates (`docs/design/agent-teammates.md`, "The repo"): exactly
one bare git repo per agent user, served over smart HTTP behind Macro auth,
plus the internal create/delete API and its client.

## How it works

`POST /internal/repos` creates the bare repo from the starter agent
(`packages/starter-agent/`), with one initial commit on `main`: the
template's files, `agent.json` rendered from `agent.example.json` (owner =
the seed's `creator_id`, `me` = the agent's user id, its name and email), and
`state/memory/identity/identity.md` when the invite gave a job or a
personality (none means the agent asks its owner). It upserts the
`agent_repos` row with the SHA-256 of a new `mrt_` token, returned once. Git
requests (`/{agent_user_id}.git/...`, id percent-encoded) go through
`AgentGitService::serve_git`, which authorizes, enforces limits, and hands the
request to `git http-backend` (CGI, both bodies streamed).

`build.rs` recursively embeds every file under the template, watching
directories so additions and removals rebuild it, and skips what only the
monorepo checkout has (`node_modules`, `.scripts*`, `.worktrees`, the
workspace `biome.jsonc`); symlinks (`CLAUDE.md`) are embedded as their
target's contents, and executable bits are kept. The HTTP clone test verifies
every rendered file is seeded with its contents. A seed without a
`creator_id` is refused: an agent without an owner obeys nobody. Keep the
template in both full and per-service filtered Nix sources, including its
standalone `bun.lock` (`tooling/scripts/starter-agent-lock.sh`).

## Start here

- `src/domain/service.rs`: every access and limit decision.
- `src/outbound/git_http_backend.rs`: the CGI bridge.

## Scope

- Owns: `agent_repos`, the repo directories, repo tokens.
- Not here: creating the agent account → `crates/team_agents`; team roles →
  `crates/teams` (read through `TeamRepository`).

## Boundaries

- Used by: `services/agent_harness_service` (composition root, `src/agent_git.rs`,
  under `/agent-git`); agent
  provisioning through `client::AgentGitClient` (`default-features = false,
  features = ["client"]`), so callers need no storage volume.

## Checks

- `TMPDIR=/home/wolf/tmp cargo test -p agent_git` (`SQLX_OFFLINE` unset; needs
  `git` on `PATH`). `tests/smart_http.rs` runs real `git clone`/`push`.
- `nix build .#checks.x86_64-linux.pruned-deploy-src-starter-agent` verifies
  that full and pruned service sources preserve every template file.

## Gotchas

- Repo tokens and stored SHA-256 digests use `agent_credentials` newtypes.
  Parse at HTTP/client/database boundaries; Debug redacts both, and ordinary
  equality compares fixed-length secrets and digests in constant time. Wire
  tokens remain strings.
- Credentials: HTTP Basic password = repo token (read and push, own repo
  only); otherwise a Macro user credential (cookie, bearer, or
  `x-macro-user-api-key`, e.g. via `git -c http.extraHeader=...`) of a team
  admin or owner reads only.
- Creating again for the same team keeps the repo and replaces the token
  (explicit re-key); another team is 409.
- Directories are `<sha256(user id)>.git`. Delete removes the directory before
  the row; the `"User"` cascade alone leaves the directory behind.
- Push limits: size is measured before each push (refused at the cap, and one
  push may not carry more than the remaining room); the rate limit is a
  token bucket in the repo's `agent_repos` row (`push_tokens`), shared by
  every replica.
- Every replica serves every repo from the same EFS volume. A receive-pack
  holds the repo's Postgres advisory lock (`PgRepoLock`: a session of its own,
  closed on drop) until its response ends; create, ensure and delete take the
  same lock. git's own lockfiles stay as the second guard.
- Receive-pack rejects every Content-Encoding with 415; the remaining quota is
  also passed to git as `receive.maxInputSize`. Both receive/transfer object
  fsck checks are enabled through process config. Missing repos and bad tokens
  share the same 401 response.
- git runs with a cleared environment so `APP_SECRETS_JSON` never reaches it.
- `enable-agent-teammates` off for the repo agent's creator (the
  `creators` adapter, `agent_credentials::rollout`) makes the repo look absent
  to every credential. Never evaluate it for the agent's own account: PostHog
  targeting never matches it.

- `POST /internal/repos/ensure` is internal-only recovery: supply the original
  persona token and seed. It inserts a missing row, validates team and token,
  and recreates missing storage without rotating a live credential or replacing
  an existing repo. Missing storage is reseeded; deleted pushed history needs
  a storage backup or recovery from the agent's working clone.

- The single service task serializes create, ensure and delete across their full
  database and filesystem mutations so recovery cannot publish storage after a
  concurrent deletion completes.

- `GET`/`PUT /internal/repos/{agent_user_id}/voice` (internal key) read and
  commit `config/voice.json` (`{"model":"aura-2-<name>-<language>"}`,
  `domain::voice::VoiceModel`) for a team the caller already authorized; another
  team is 409, a missing repo or an unreadable file is 404. The commit is built
  with plumbing on a private index (never a work tree), so symlinks the agent
  committed are never followed; a symlinked `config` refuses the write. It is
  swapped onto `main` with `update-ref <new> <old>` and rebuilt if a push landed
  first; saving the current voice commits nothing. A seed `voice` replaces the
  template's default file at creation.

`agent_git.transfer` retains its span through request/response streaming and
backend exit, records byte counts and fixed failure categories, and uses the
SHA-256 repository identity. Never export CGI stderr or raw repository paths.

The CGI request and process pumps use the composition root's `TaskTracker`;
close and drain it after HTTP shutdown before exiting the runtime. The service's
eight-second limit bounds only tracker draining after Axum's graceful shutdown,
not the service's whole shutdown. Git process completion cancels its stdin pump
so an unfinished client body cannot retain it.
