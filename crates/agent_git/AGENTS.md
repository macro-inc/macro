# agent_git

## What it is

Agent brains (`docs/design/agent-brains.md`, "The workspace repo"): exactly
one bare git repo per agent user, served over smart HTTP behind Macro auth,
plus the internal create/delete API and its client.

## How it works

`POST /internal/repos` creates the bare repo from the canonical
`packages/brain/template/`, plus `template/gitignore`, with the
request's persona seed substituted into `OPERATING.md` (one initial commit on
`main`) and upserts the `agent_repos` row with the SHA-256 of a new
`mrt_` token, returned once. Git requests (`/{agent_user_id}.git/...`, id
percent-encoded) go through `AgentGitService::serve_git`, which authorizes,
enforces limits, and hands the request to `git http-backend` (CGI, both bodies
streamed).

Embed every file the brain reads before starting: its charter, prompts, JSON
configuration, lock and initial self memory. `creator_id` records the creating
admin's Macro user ID; older saved seeds may omit it and use the team owner.
Render relevance questions through JSON values, bounding persona substitutions
to the brain's 500 UTF-16-unit question limit. Keep the canonical template in
both full and per-service filtered Nix sources, including `brain.lock`.

## Start here

- `src/domain/service.rs`: every access and limit decision.
- `src/outbound/git_http_backend.rs`: the CGI bridge.

## Scope

- Owns: `agent_repos`, the repo directories, repo tokens.
- Not here: creating the agent account → `crates/team_agents`; team roles →
  `crates/teams` (read through `TeamRepository`).

## Boundaries

- Used by: `services/agent_git_service` (composition root); agent
  provisioning through `client::AgentGitClient` (`default-features = false,
  features = ["client"]`), so callers need no storage volume.

## Checks

- `TMPDIR=/home/wolf/tmp cargo test -p agent_git` (`SQLX_OFFLINE` unset; needs
  `git` on `PATH`). `tests/smart_http.rs` runs real `git clone`/`push`.
- `nix build .#checks.x86_64-linux.pruned-deploy-src-brain-template` verifies
  that full and pruned service sources preserve every canonical template file.

## Gotchas

- Credentials: HTTP Basic password = repo token (read and push, own repo
  only); otherwise a Macro user credential (cookie, bearer, or
  `x-macro-user-api-key`, e.g. via `git -c http.extraHeader=...`) of a team
  admin or owner reads only.
- Creating again for the same team keeps the repo and replaces the token
  (explicit re-key); another team is 409.
- Directories are `<sha256(user id)>.git`. Delete removes the directory before
  the row; the `"User"` cascade alone leaves the directory behind.
- Push limits: size is measured before each push (refused at the cap, and one
  push may not carry more than the remaining room); the rate limit is
  in-memory per process, so the service runs one task.
- git runs with a cleared environment so `APP_SECRETS_JSON` never reaches it.

- `POST /internal/repos/ensure` is internal-only recovery: supply the original
  persona token and seed. It inserts a missing row, validates team and token,
  and recreates missing storage without rotating a live credential or replacing
  an existing repo. Missing storage is reseeded; deleted pushed history needs
  a storage backup or recovery from the agent's working clone.

- The single service task serializes create, ensure and delete across their full
  database and filesystem mutations so recovery cannot publish storage after a
  concurrent deletion completes.
