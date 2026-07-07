# Running Locally

Use `just run_local` to run the full app on your machine.

```bash
just run_local
```

This starts local infra, backend services, the local proxy, and the frontend.
When startup finishes, the command prints the frontend URL and the important
service URLs.

## Requirements

The easiest path is to use the repo's Nix shell. It should provide the Rust
toolchain, `cargo-zigbuild`, Zig, Bun, sqlx, and the other project tools.

Outside the Nix shell, you need at least:

- Docker with Compose v2
- Doppler CLI
- Rust toolchain
- `cargo-zigbuild` and Zig
- Bun
- sqlx CLI

You should also be logged in to Doppler and have access to the `local` project:

```bash
doppler login
```

`run_local` pulls the `lcl_personal` Doppler config by default. If you want to
run without Doppler, use:

```bash
just run_local --no-doppler --env-file ./local.env
```

## Running One Stack

Start the default stack:

```bash
just run_local
```

Useful preflight:

```bash
just doctor-local
```

While `run_local` is attached:

- Press `r` to rebuild and reload changed Rust services.
- Press `q` to tear the stack down and exit.

Prefer `q` over just closing the terminal. It stops/removes the instance's
containers immediately, so the next startup does not have to clean up a stale
stack first.

## Running Multiple Instances

Use named instances when you want multiple local stacks at once, especially
across worktrees:

```bash
just run_local --instance agent-a
just run_local --instance agent-b
```

Each named instance gets its own Compose project, volumes, networks, generated
env files, proxy, frontend port, and backend ports. Ports are deterministic for
the instance name, so the same name should get the same port window on every
run.

If a generated port window conflicts with something else on your machine:

```bash
just run_local --instance agent-a --port-base 23000
```

Generated files live at:

```text
infra/local/generated/<instance>
```

## What Gets Rebuilt

Rust backend services are built on the host with `cargo zigbuild` and mounted
into a shared runtime image. Docker is not compiling those Rust services during
normal `run_local`.

Pressing `r` rebuilds the Rust binaries and restarts only the services whose
binaries changed.

The current rough edge is auxiliary Docker-built services:

- `sync_service`
- `lexical_service`
- `websocket_service`

Those are not rebuilt by default. If you change sync-service, lexical-service,
or anything that affects their Docker images, the running stack can keep using a
stale image.

To force those services to rebuild:

```bash
just run_local --build-aux-services
```

When the stack was started with `--build-aux-services`, pressing `r` also
rebuilds those auxiliary images and recreates their containers. That is slower,
so leave it off unless you are actively working on those services or need to
pick up a change there.

If you already started without `--build-aux-services` and suspect a stale
sync/lexical image, press `q` and restart with the flag.

## Headless Mode (previews, agents, CI)

`just stack` is the same stack without a terminal attached: no hotkey loop, no
dev server. The frontend is built once (a dev-mode bundle with production
optimizations) and served statically by the instance's Caddy proxy, so the whole
product lives behind **one origin** and a finished `up` leaves only Docker
containers running — nothing to babysit.

```bash
just stack up                  # bring everything up, print URLs, return
just stack status --json      # machine-readable state (containers, health, URLs)
just stack update             # rebuild + reload only changed services (the `r` hotkey)
just stack update --frontend  # also rebuild the frontend bundle
just stack down               # containers + volumes + tunnel + state
```

All the `run_local` flags apply (`--instance`, `--no-doppler --env-file`,
`--no-build`, `--binaries-dir`); CI can hand in a prebuilt bundle with
`--frontend-dist`. The app is served at `<proxy>/app/` — the bundle resolves its
backend from the origin it is served on, so the same stack works on localhost,
through a tunnel, or behind a preview hostname without a rebuild.

To share a running stack publicly (a preview link, a QA session):

```bash
just stack expose --detach    # prints a https://*.trycloudflare.com URL
just stack expose --stop
```

`expose` uses a Cloudflare quick tunnel (requires `cloudflared` on PATH; no
account needed). The URL is public and unauthenticated — anyone who has it
reaches your stack. Share deliberately and stop the tunnel when done.

## Common Commands

Run local binaries against shared dev resources instead of a fully local stack:

```bash
just run_dev
```

Stop an instance but keep its volumes:

```bash
just stop_local --instance agent-a
```

Remove an instance's containers, volumes, and named-instance networks:

```bash
just destroy_local --instance agent-a
```

Drop, recreate, and migrate an instance database:

```bash
just reset_local --instance agent-a
```

For the default instance, omit `--instance`.
