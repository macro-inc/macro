---
name: run-app
description: Run the Macro app on Cursor Cloud and see your edits, including frontend hot reload. Use when asked to run the app, test changes in the browser, update the frontend or backend of a running stack, or before touching stack.sh, rebuild.sh, frontend.sh, or just stack.
---

# Running the app on Cursor Cloud

The app lives at **http://localhost:3000/app**. There is exactly one frontend: a hot-reloading Vite dev server. The backend containers sit behind the proxy at http://localhost:8090 (APIs only, no frontend).

| What you need | Command | Time |
| --- | --- | --- |
| App running (first time) | `bash .cursor/stack.sh` | minutes (Nix build + bring-up) |
| See backend (Rust) edits | `bash .cursor/rebuild.sh` | seconds if nothing changed; minutes to compile changed services |
| See frontend (`apps/web`) edits | nothing — they apply on save | ~1 s |

Both scripts are idempotent. Re-running them on a healthy system is safe and fast.

Two ground rules:

- `docker`, `just`, `bun`, and `doppler` exist only inside the pinned nix shell. The scripts re-enter it themselves. For any other command, prefix it: `nix develop /workspace --command docker ps`. A bare `docker ps` or `bunx vitest` on the host fails or hangs.
- Every URL here is VM-local. The user's laptop cannot open them; verify with the in-VM browser and screenshots.

## First start

```bash
bash .cursor/stack.sh
```

Brings up Docker, databases, every backend service behind the proxy, and the frontend dev server. The first run is slow: services changed since the environment bake compile under Nix. Let it finish. Do not kill the Nix build, copy binaries out of `/nix/store`, or bypass it with hand-rolled `docker compose` commands; every past attempt ended in unexecutable binaries or a half-broken stack.

Login is passwordless. Enter any email; the login API returns the code in its response, and codes also appear in Mailpit at http://localhost:8025.

## Backend (Rust) edits

```bash
bash .cursor/rebuild.sh
```

Nix-builds the service binaries and remounts them into the running containers. Data, logins, and documents survive. Unchanged binaries are a no-op ("binaries unchanged — mounts left as-is").

Do not run `just stack down`, `just stack up`, or `stack.sh --fresh` to pick up an edit. `up` is full-delete/full-create: it wipes the database volumes.

## Frontend edits

No command. The dev server watches `apps/web`; save the file and the page updates. Confirm in `~/.cursor-cloud/frontend-dev.log` (`hmr update` lines) if unsure.

- If http://localhost:3000/app stops responding, restart it: `bash .cursor/frontend.sh stop && bash .cursor/frontend.sh` (also the fix after changing frontend deps or Vite config).
- Never use `just stack update --frontend` or a production `vite build` to see an edit. Those build a static artifact the Cloud stack does not serve.

## What NOT to do

- Do not re-run `stack.sh --fresh` or `just stack up` to see edits. That wipes volumes. `--fresh` is only for a deliberate reset.
- Do not `cargo build` / `just build` and expect containers to change. Containers mount Nix-built binaries; `rebuild.sh` is the only path.
- Do not run `just run_local`. It is the laptop TUI flow; on Cloud use the scripts.
- Do not diagnose `agent_harness_service` restart loops when AI provider keys are absent. That loop is expected without `DOPPLER_TOKEN`.
- Do not skip the app when asked to show a change works. Unit tests and SQL probes are not a product walkthrough; bring the stack up, log in, and demonstrate it in the UI.

## Troubleshooting

- Login shows "unable to lookup identity providers": FusionAuth is in maintenance mode (`docker ps` shows `macro-fusionauth-1 ... (unhealthy)`, direct `curl localhost:9011/api/status` returns 302). It could not reach its database at boot. Fix: `docker restart macro-fusionauth-1`, wait for `(healthy)`.
- Page loads but API calls fail: the backend is down, not the frontend. Check `just stack status --json` and bring it back with `bash .cursor/stack.sh`.

## Status and logs

```bash
just stack status --json     # containers, health, URLs
docker compose -p macro logs -f <service>
```
