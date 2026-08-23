---
name: run-app
description: Run the Macro app on Cursor Cloud and see your edits, including frontend hot reload. Use when asked to run the app, test changes in the browser, update the frontend or backend of a running stack, or before touching stack.sh, rebuild.sh, frontend.sh, or just stack.
---

# Running the app on Cursor Cloud

Three commands. Pick by what changed. Never mix them up: the wrong one wastes 20+ minutes or wipes your data.

| What you need | Command | Time | URL |
| --- | --- | --- | --- |
| App running (first time) | `bash .cursor/stack.sh` | minutes (Nix build + bring-up) | http://localhost:8090/app/ |
| See backend (Rust) edits | `bash .cursor/rebuild.sh` | seconds if nothing changed; minutes to compile changed services | same |
| See frontend (`apps/web`) edits | `bash .cursor/frontend.sh` | ~3 min first start, then instant on save | http://localhost:3000/app |

All three are idempotent. Re-running any of them on a healthy system is safe and fast.

## First start

```bash
bash .cursor/stack.sh
```

Brings up Docker, databases, every service, and a static frontend bundle behind one proxy origin. The first run is slow: services changed since the environment bake compile under Nix. Re-running later is safe; a healthy stack prints its URLs and exits.

Login is passwordless. Enter any email; the login API returns the code in its response, and codes also appear at http://localhost:8090/mailpit/.

## Backend (Rust) edits

```bash
bash .cursor/rebuild.sh
```

Nix-builds the service binaries and remounts them into the running containers. Data, logins, and documents survive. Unchanged binaries are a no-op ("binaries unchanged — mounts left as-is").

Do not run `just stack down`, `just stack up`, or `stack.sh --fresh` to pick up an edit. `up` is full-delete/full-create: it wipes the database volumes.

## Frontend edits (hot reload)

```bash
bash .cursor/frontend.sh
```

Starts a Vite dev server against the running stack. Edits under `apps/web` apply on save; no build step.

- Use **http://localhost:3000/app** to view frontend work. The proxy URL (8090/app/) serves the static bundle, which does NOT pick up frontend edits.
- Logs: `~/.cursor-cloud/frontend-dev.log` (look for `hmr update` lines).
- Restart after changing frontend deps or Vite config: `bash .cursor/frontend.sh stop && bash .cursor/frontend.sh`.
- To refresh the static bundle instead (rarely needed, e.g. testing the built artifact): `just stack update --frontend`. Slow; prefer the dev server.

## What NOT to do

- Do not re-run `stack.sh --fresh` or `just stack up` to see edits. That wipes volumes. `--fresh` is only for a deliberate reset.
- Do not rebuild the static frontend to see frontend changes. Use `frontend.sh` and port 3000.
- Do not `cargo build` / `just build` and expect containers to change. Containers mount Nix-built binaries; `rebuild.sh` is the only path.
- Do not run `just run_local`. It is the laptop TUI flow; on Cloud use the three scripts.
- Do not diagnose `agent_harness_service` restart loops when AI provider keys are absent. That loop is expected without `DOPPLER_TOKEN`.

## Troubleshooting

- Login shows "unable to lookup identity providers": FusionAuth is in maintenance mode (`docker ps` shows `macro-fusionauth-1 ... (unhealthy)`, direct `curl localhost:9011/api/status` returns 302). It could not reach its database at boot. Fix: `docker restart macro-fusionauth-1`, wait for `(healthy)`.
- Frontend edit not visible: you are looking at http://localhost:8090/app/ (static bundle). Use http://localhost:3000/app.
- Backend edit not visible: you ran `cargo build` instead of `bash .cursor/rebuild.sh`.

## Status and logs

```bash
just stack status --json     # containers, health, URLs
docker compose -p macro logs -f <service>
```
