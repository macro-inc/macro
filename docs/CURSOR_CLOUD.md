# Cursor Cloud

**Only for Cursor Cloud VMs.** On a local machine, `.cursor/*.sh` can prompt for
sudo and are the wrong entry points. Use [running locally](RUNNING_LOCALLY.md)
and the [web agent guide](../apps/web/AGENTS.md) instead.

## Start only what the task needs

Boot starts the Nix daemon, not Docker, databases, or the product. Pure-logic tests
need no infrastructure. Use the supported scripts from the repository root:

| Task | Command |
| --- | --- |
| Start Postgres and Redis for DB-backed tests | `bash .cursor/infra.sh` |
| Start the product with a hot-reloading frontend | `bash .cursor/stack.sh` |
| Pick up backend Rust edits without wiping volumes | `bash .cursor/rebuild.sh` |
| Pick up frontend source edits | Save the file; Vite applies them on save. |

The scripts re-enter the pinned Nix shell themselves; invoke them with plain
`bash`. For other commands, use the pinned shell, e.g. from the root:

```bash
nix develop --command env -u SQLX_OFFLINE cargo test -p <package>
```

Run tests per affected crate, with `SQLX_OFFLINE` unset. Installation baked the
initial database and test envs; apply new migrations as needed. Use
[database development](DATABASE_DEVELOPMENT.md) for SQLx preparation and errors.

## Run and verify the app

Follow the [run-app skill](../.claude/skills/run-app/SKILL.md) for the full browser
walkthrough, frontend restarts, and login troubleshooting.

- App: <http://localhost:3000/app>; backend proxy: <http://localhost:8090>.
  These URLs are inside the VM, not reachable from the user's laptop.
- `stack.sh` leaves a healthy backend running. After Rust edits, use `rebuild.sh`:
  it builds Nix binaries and remounts them via `just stack update --binaries-dir`,
  preserving volumes. `cargo build` alone does not update running containers.
- Do not replace the scripts with `just run_local`, hand-rolled Compose, or
  `just stack up`. **`stack.sh --fresh` deliberately wipes and recreates the
  stack**; use it only with explicit approval, never to pick up code edits.
- Sign in with any email; passwordless login creates the user on demand. The
  auth service is built with `return_passwordless_code`, so the login API returns
  the code. Codes also appear in Mailpit at <http://localhost:8025>.
- Seeding is optional, not required for login. For multi-user permission fixtures,
  use `just seed-scenario apply --file seed/scenarios/team-perms.json` inside Nix.
- An `agent_harness_service` restart loop is expected without AI provider keys;
  see the runtime secrets section below rather than debugging it as a code regression.

## Runtime secrets

Set `DOPPLER_TOKEN` as a Cursor environment **runtime** secret: a Doppler service
token scoped to project `local`, config `lcl_preview`. The token stored in CI as
`DOPPLER_PREVIEW_TOKEN` also works. Never paste tokens into chat or commit them.

With the token present, `stack.sh` pulls those secrets, including AI provider
keys. Without it, the stack uses `--no-doppler` stubs and real external
integrations are unavailable. Install/bake always uses stubs so the durable
snapshot does not embed secrets.

Existing agents do not inherit newly added environment secrets; start a new
agent after adding the token.

## Environment maintenance and binary cache

This section is for Cloud environment setup, not ordinary feature work.

- [`install.sh`](../.cursor/install.sh) prepares durable dependency caches,
  databases, test dependencies, frontend dependencies, service binaries, and a
  stack-init snapshot. It then stops dockerd and nix-daemon so the bake can exit.
- [`start.sh`](../.cursor/start.sh) runs at boot and only ensures the Nix daemon
  and cache links, keeping sessions and subagents cheap to start.
- Nix is the only host dependency. The pinned shell provides Docker CLI/daemon,
  Compose, `fuse-overlayfs`, and OpenSSH; use its `ssh-keygen`.
- Service binaries are built/cached as `.#local-stack-binaries`, realized with
  `nix build .#local-stack-binaries`. The
  [`push_local_stack_binaries.yml`](../.github/workflows/push_local_stack_binaries.yml)
  workflow pushes them to the private S3 Nix cache on main; it is separate from
  the deploy pipeline.
- Set `NIX_CACHE_AWS_ACCESS_KEY_ID` and `NIX_CACHE_AWS_SECRET_ACCESS_KEY` as Cursor
  environment secrets with read-only access to that cache bucket.
