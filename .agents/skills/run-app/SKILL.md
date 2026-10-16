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

Do not run `just run_local`. That is the laptop TUI.

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

## Status

```bash
just stack status --json
docker compose -p macro logs -f <service>
```
