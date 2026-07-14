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
