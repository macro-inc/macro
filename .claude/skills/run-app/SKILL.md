---
name: run-app
description: >-
  Run the Macro app on Cursor Cloud and pick up edits. Use when asked to run
  the app, open it in the browser, test a frontend or backend change, hot
  reload, or before touching stack.sh, rebuild.sh, frontend.sh, or just stack.
---

# Run the app

The app is http://localhost:3000/app. Open it in the VM browser. The user's laptop cannot reach these URLs.

| Goal | Command |
| --- | --- |
| Start | `bash .cursor/stack.sh` |
| After a Rust edit | `bash .cursor/rebuild.sh` |
| After an `apps/web` edit | save the file |

The `.cursor` scripts re-enter the pinned nix shell. For any other `docker`, `just`, `bun`, or `doppler` command, prefix with `nix develop /workspace --command`.

Do not run `just run_local`. That is the laptop TUI. On a laptop, use `docs/RUNNING_LOCALLY.md`.

## Start

```bash
bash .cursor/stack.sh
```

Let the first run finish. It compiles whatever changed since the environment bake. Do not kill the Nix build, copy binaries out of `/nix/store`, or replace this with hand-rolled `docker compose`.

Log in with any email. The login API returns the code. Codes also land in Mailpit at http://localhost:8025.

## After a Rust edit

```bash
bash .cursor/rebuild.sh
```

Volumes stay. If the log says binaries are unchanged, the mounts were left alone.

Do not run `just stack up` or `stack.sh --fresh` to pick up an edit. `up` deletes the stack and recreates it. Use `--fresh` only when you mean to wipe.

`cargo build` and `just build` do not remount containers. `rebuild.sh` is the remount path.

## After an `apps/web` edit

Save the file. Vite watches `apps/web`. If the page does not update, read `~/.cursor-cloud/frontend-dev.log` for `hmr update`.

If http://localhost:3000/app stops responding, restart the dev server:

```bash
bash .cursor/frontend.sh stop && bash .cursor/frontend.sh
```

Use the same restart after a frontend dependency or Vite config change.

Do not run `just stack update --frontend`. That builds a static bundle. This Cloud stack does not serve one. On a `--no-frontend` stack that flag then tells you to re-run `just stack up`, which wipes volumes.

## Show the change

Bring the stack up, log in, and demonstrate the change in the UI. Unit tests and SQL probes are not a walkthrough.

## If login fails

If the page says "unable to lookup identity providers", FusionAuth is in maintenance mode. `docker ps` shows `macro-fusionauth-1` as unhealthy. `curl localhost:9011/api/status` returns 302.

```bash
docker restart macro-fusionauth-1
```

Wait until the container is healthy.

If the page loads and API calls fail, the backend is down. Run `just stack status --json`, then `bash .cursor/stack.sh`.

Do not chase `agent_harness_service` restart loops when `DOPPLER_TOKEN` is absent. That loop is expected.

## Secrets

Set `NIX_CACHE_AWS_ACCESS_KEY_ID` and `NIX_CACHE_AWS_SECRET_ACCESS_KEY` as Cursor environment secrets (read-only on the Nix cache bucket). Set `DOPPLER_TOKEN` as a Cursor **runtime** secret: a Doppler service token for the `local` project's `lcl_preview` config (`DOPPLER_PREVIEW_TOKEN` also works). Do not paste the token into chat. With that token, `bash .cursor/stack.sh` pulls secrets instead of `--no-doppler`. Install/bake stays on stubs. Existing agents do not pick up newly added secrets — start a new agent after adding one.

These three secrets are bootstrap-only. `ensure_nix_daemon` reads the Nix cache keys before Doppler is available, and `stack_doppler_args` maps `DOPPLER_PREVIEW_TOKEN` to `DOPPLER_TOKEN`. They intentionally bypass the `macro_env_var` / Doppler application-variable flow.

## Infra and tests

Nothing runs after boot. Before DB-backed `cargo test -p <crate>`, run `bash .cursor/infra.sh` once (Docker, Postgres, Redis), then `just setup_test_envs` and `just initialize_dbs`. Pure-logic crate tests need nothing. `just seed-scenario apply --file seed/scenarios/team-perms.json` is optional, for multi-user team/permission fixtures.

## Status

```bash
just stack status --json
docker compose -p macro logs -f <service>
```
