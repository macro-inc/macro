---
name: local-preview
description: Start a local preview of the app for the user and share an HTTPS link to it. Use when asked for a local preview, to "run it", "spin it up", "show me", or for a link to try a change on this machine (not Cursor Cloud; that is the run-app skill).
---

# Local preview

Two ways to preview, from [running locally](../../../docs/development/running-locally.md).
Pick one, start it, and hand the user an HTTPS hostname link.

| Preview | Runs | Use when |
| --- | --- | --- |
| **Web app only** | Vite in `apps/web` against hosted `*-dev` services | The change is frontend-only (`apps/web`, `packages/`) |
| **Full stack** | Docker infra, local Rust services, Caddy proxy, frontend | The change touches `crates/`, `services/`, migrations, or needs private data |

## 1. Choose

- Look at the changed files (`git diff --name-only $(git merge-base HEAD origin/main)`
  plus uncommitted ones). Only frontend paths: web app. Only backend paths, or
  both: full stack (it includes the frontend).
- If it isn't obvious (no changes yet, or the user wants to try something
  unrelated to the diff), ask the user: "web app only, or the full local stack?"
  Mention the trade: the web app starts in a minute against shared dev data; the
  stack takes several minutes and runs everything locally.

## 2. Start it

**Web app only**

1. Pick a free port; never assume 3000 is yours:
   `lsof -nP -iTCP:<port> -sTCP:LISTEN -t`. Reuse a running Vite only if its cwd
   (`lsof -p <pid> | awk '$4=="cwd"'`) is this worktree.
2. From `apps/web`, inside the Nix shell, run `PORT=<port> bun run dev` in the
   background. The first run may build wasm for a few minutes.
3. Wait for Vite to print `App: https://<hostname>:<port>/app/`.

**Full stack**

1. Use a named instance per worktree so you never collide with another session:
   `--instance <worktree-name>`. Never stop, reset, or destroy an instance you
   didn't start.
2. Inside the Nix shell, run `just run_local --instance <name>` (add
   `--no-doppler` if Doppler isn't authenticated). Without a terminal it runs in
   the background and returns once ready, or exits nonzero naming the failed step
   and log. It survives your Bash call timing out; if that happens, run `just
   run_local wait --instance <name>`. Repeating it never wipes an instance:
   only `--fresh` does. Frontend edits apply on save. After Rust edits, run
   `just run_local rebuild --instance <name>`. Working on one service, add
   `--services <name>` (comma-separated compose or binary names) to rebuild and
   restart only it; services left on older code are listed in `stale_services`
   from `status --json`, and `rebuild` with no flag catches them all up.
3. Read `frontend_url` from `just run_local status --json --instance <name>`, and
   build the link from `hostname`, even if a URL is printed with `localhost`.
4. Offer seed data: `just seed-scenario --instance <name> apply --file
   seed/scenarios/team-perms.json` prints persona login links.

If startup fails, run `just doctor-local --instance <name>`; for running-stack
problems use the `live-debug` skill. Don't wipe volumes to recover.

## 3. Share the link

Always share the HTTPS URL on the machine's hostname, never `localhost`, an IP
address, or plain HTTP:

- Web app: `https://<hostname>:<port>/app/`
- Full stack: `https://<hostname>:<proxy-port>/app/`

The certificate is issued from the repo's development CA for the output of
`hostname` (plus `localhost` and loopback); an IP address isn't in it, so an IP
link fails TLS. Tell the user, once:

- Trust `infra/local/certs/ca.pem` on the viewing machine (see
  `infra/local/certs/README.md`).
- The viewer must resolve the hostname and reach the port (same network or
  tailnet).
- Sign in with an email code on that hostname. On the web-app preview it is a
  real email to a dev account; on the stack the code lands in Mailpit: use
  `mailpit_url` from `just run_local status --json`.

Public links: only if the user explicitly asks to share outside their network.
Then the stack needs `just run_local --instance <name> --with-cf-tunnel`, which
prints a `https://….trycloudflare.com/app/` URL. Say first that it publishes a
passwordless-login stack to the internet.

## 4. Report

One short message: which preview and why, the HTTPS link, how to sign in, how to
stop it (`just run_local stop --instance <name>`, `q` in an attached `run_local`,
or the background Vite process), and anything that failed or was skipped.
