# Running locally

This guide covers two ways to run Macro on your machine. Cursor Cloud uses `.claude/skills/run-app/SKILL.md`, not this file.

If you only change the frontend, run the frontend against hosted services. You do not need Docker or the local stack.

If you change a backend service, the database, or behavior that must stay on your machine, run the local stack.

## Choose a path

- **Frontend against hosted services.** Vite on your machine. APIs on hosted `*-dev` services. See [Run the frontend against hosted services](#run-the-frontend-against-hosted-services).
- **Local stack.** Docker, local infrastructure, and local Rust services. See [Run the local stack](#run-the-local-stack).

## Shared prerequisites

Install Nix before you start:

1. [Nix](https://nix.dev/install-nix) package manager

Clone the repository:

```bash
git clone https://github.com/macro-inc/macro.git
cd macro
```

The Nix shell provides `just`, Cargo, the Rust toolchain, Bun, `wasm-pack`, sqlx, zig, and cargo-zigbuild. You do not need to install these tools separately.

```bash
nix develop
```

If `nix develop` fails, enable the experimental features:

```bash
nix develop --extra-experimental-features nix-command --extra-experimental-features flakes
```

Nix requires these experimental features to work. The command above enables them for one run. To enable them permanently, set this in `~/.config/nix/nix.conf`:

```
experimental-features = nix-command flakes
```

The default shell does not include the Tauri platform dependencies. They are large, so they live in their own shells. For Linux desktop development, use `nix develop .#tauri-linux`. For Android development on x86_64 Linux, use `nix develop .#tauri-android`.

## Run the frontend against hosted services

The web app talks to hosted `*-dev` services when you run `bun run dev` from the web app.

Limits:

- You still need Nix. The first `bun run dev` may compile wasm. Later runs skip that compile when versions match.
- The UI calls hosted `*-dev` services and shared data.
- Sign-in is not the local Mailpit flow. If you need a private database or to change a backend service, use the [local stack](#run-the-local-stack).

From the repository root, inside the Nix shell:

```bash
bun install
cd apps/web
bun run dev
```

The first run, or a run after a wasm version change, may build wasm packages. Vite prints a local URL when it is ready.

## Run the local stack

The local stack runs without Doppler. It runs Postgres, Redis, LocalStack, OpenSearch, Kafka, and FusionAuth in Docker, with dummy AWS credentials and fixed test secrets.

On Linux, the Nix dev shell supplies the Docker CLI, daemon, Compose, and `fuse-overlayfs`. Nix is the only host dependency.

On macOS, install a Docker runtime such as Docker Desktop, OrbStack, or Colima. The Nix dev shell supplies the Docker CLI, but macOS still needs the runtime to provide the daemon.

Run the preflight check before the first start:

```bash
just doctor-local
```

The check tests the Docker daemon, the toolchain, and the required ports. It reports any problem and suggests a fix. If a start fails, run the check again.

Run this command from the repository root if you do not have Doppler access:

```bash
just run_local --no-doppler
```

The local stack does not need Doppler. It uses the code-defined local configuration with dummy AWS credentials and fixed test secrets. Most contributors are not on the team, so this is the common path.

The stack boots with stubbed values for every config the services require, including the third-party integrations (Google, GitHub, Stripe, CloudFront). Those flows do not work against real services with the stubs. The rest of the stack is fully functional: auth, documents, email, and search.

To use a real integration locally, supply its keys via `--env-file` — see [Integration Secrets](#integration-secrets) below.

Run this command if you have Doppler access. It pulls the `lcl_personal` config. Then it overlays the code-defined local defaults. Every integration value is real:

```bash
just run_local
```

If you prefer to test against real cloud infrastructure, you need [Doppler](https://www.doppler.com) for secrets management.

This command:

- Builds the Rust backend services
- Starts the local infrastructure (Postgres, Redis, LocalStack, OpenSearch, Kafka, FusionAuth)
- Starts the backend services
- Starts the local proxy and the frontend

When startup finishes, the command prints the frontend URL and the important service URLs.

Open the frontend URL in your browser.

The stack does not create accounts in advance. Passwordless login creates a user
on demand. Register with any email address. FusionAuth sends you a one-time code
by email. That email lands in **Mailpit** at http://localhost:8025, not in a real
inbox.

### Seeding sample data (recommended)

A bare stack has no content to click through. The seed CLI creates a realistic
world: users, teams, channels, projects, documents, tasks, chats, calls, emails,
and messages. The world uses realistic permissions.

From the repository root, after the stack is up:

```bash
just seed-scenario apply --file seed/scenarios/team-perms.json
```

`apply` creates a FusionAuth account for each persona. It prints a login link per
persona, for example `http://alice.localhost:3000/app/login?email=alice@seed.macro.local`.
Open each link in a plain browser tab. Each persona hostname has its own cookie
jar. You can drive several personas side by side against one stack.

Useful commands:

- `just seed-scenario status --file seed/scenarios/team-perms.json` — show what is seeded and re-print the login links.
- `just seed-scenario reset --file seed/scenarios/team-perms.json` — remove the scenario's rows and its user accounts by email.
- `just seed-scenario matrix --file seed/scenarios/team-perms.json` — check the expected access level for every user and entity pair against the live database.

`apply` touches only rows that carry the scenario `5eed` id marker, plus the
persona accounts it created. It is safe to run against a stack that you tested in.

## Integration Secrets

A `--no-doppler` stack boots with deterministic stubs for every value the services' config loaders require. The stubs are enough to start the services. The third-party integrations they back do not work until you supply real values:

| Integration | Keys | Stub behavior |
| --- | --- | --- |
| Google login / Gmail | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET_KEY` | Google SSO and Gmail inbox linking are unavailable. Local signup still works. The email service reports no Gmail grant and skips inbox syncing. |
| GitHub login | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_IDP_ID` | Login with GitHub is unavailable |
| Stripe billing | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` | Checkout and subscription endpoints fail. Signup still works: the create-user webhook detects the stub key and skips the real Stripe call. It stores a placeholder customer id instead. |
| CloudFront signed URLs | `DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_DISTRIBUTION_URL`, `DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID`, `DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY` | Document download URLs are unsigned (fine against local S3) |

The other stubbed keys (`REDIS_HOST`, `MACRO_DB_URL`, `INTERNAL_API_KEY`, `AUTHENTICATION_SERVICE_SECRET_KEY`, `OPENSEARCH_USERNAME`, `OPENSEARCH_PASSWORD`) are internal plumbing with correct local values — you never need to override them.

To turn on an integration, create a `local.env` with the real values. Then pass it
to `run_local`:

```bash
just run_local --no-doppler --env-file ./local.env
```

Keys in the file override the code-defined defaults, so you only need to list the integrations you care about. With Doppler access, `just run_local` (without `--no-doppler`) supplies everything automatically.

## Control the Running Stack

While `run_local` is attached:

- Press `r` to rebuild the changed Rust services and reload them.
- Press `q` to stop the stack and exit.

Use `q`, not the terminal close button. `q` stops and removes the containers at once. The next start does not have to clean up a stale stack.

## Run More than One Stack

Use named instances for several local stacks at once. This helps across worktrees:

```bash
just run_local --instance agent-a
just run_local --instance agent-b
```

Each instance has its own resources:

- a Compose project
- volumes and networks
- env files
- a proxy port, a frontend port, and backend ports

The ports are deterministic for the instance name. The same name gets the same
port window on every run.

If the port window conflicts with another program, change the base port:

```bash
just run_local --instance agent-a --port-base 23000
```

The generated files for an instance live here:

```text
infra/local/generated/<instance>
```

## Port Conflicts (macOS)

The default instance binds a fixed set of host ports. macOS reserves some of them
for its own services. If the app loads but API calls return unexpected HTML, a
port is probably hijacked by an unrelated process. The two most common conflicts
on a fresh Mac:

- **Port 8080** — macOS WebDriver service (`com.apple.WebDriver.HTTPService`). It listens on this port when remote automation is on. The auth service cannot bind it.
- **Port 8090** — another project's dev server, for example an Expo server with `--port 8090`. The proxy cannot bind it.

The frontend loads, but login and API calls hit the other process. You see HTML
or console errors instead of JSON. `just doctor-local` reports the busy ports
before you start.

Run the stack on a port window that is free on your machine. You do not need to
kill the other process:

```bash
just doctor-local                         # see which default ports are busy
just doctor-local --instance test --port-base 31000   # check the new window is free
just run_local --no-doppler --instance test --port-base 31000
```

A named instance binds every service at `port-base + offset`. A free base like
`31000` moves the whole stack to one contiguous window. Use any base that is free
on your machine. See `just doctor-local` for the busy ports. Keep the same
`--instance` name and `--port-base` on later runs so the ports stay deterministic.

Use the same two flags for every command. Run the stack, seed it, and check it
with the same `--instance` and `--port-base` values:

```bash
just run_local --no-doppler --instance test --port-base 31000
just seed-scenario --instance test --port-base 31000 apply --file seed/scenarios/team-perms.json
just seed-scenario --instance test --port-base 31000 status --file seed/scenarios/team-perms.json
just status_local --instance test --port-base 31000
```

If you omit `--port-base`, a named instance gets a deterministic port window
derived from its name. That window is different from the one you chose. A stack
started with an explicit `--port-base` must be seeded with the same explicit
`--port-base`, or the seed CLI looks at the wrong database. The default instance
(no `--instance`) always uses the fixed ports and needs no extra flags.

The seeded persona login links embed the frontend port. If you switch ports, run
`just seed-scenario apply` again to get links that match the new window.
`just status_local`, with the same two flags, prints the live endpoints.

## What the Stack Rebuilds

The Rust services are built on the host with `cargo zigbuild`. The binaries are mounted into a shared runtime image. Docker does not compile these services during a normal `run_local`.

Press `r` to rebuild the binaries. Only the services whose binaries changed restart.

Three services have Docker-built images. They are not rebuilt by default:

- `sync_service`
- `lexical_service`
- `websocket_service`

If you change these services, the running stack can use a stale image. Force a rebuild with this flag:

```bash
just run_local --build-aux-services
```

When you start the stack with `--build-aux-services`, press `r` to rebuild those images and recreate their containers. This is slower, so leave the flag off unless you work on those services.

If you started without the flag and suspect a stale image, press `q`. Then start again with the flag.

## Headless Mode

`just stack` runs the same stack without an attached terminal. There is no hotkey loop and no dev server. The frontend is built once and served statically by the proxy. The whole product lives behind one origin. A finished `up` leaves only Docker containers running.

```bash
just stack up                  # bring everything up, print URLs, return
just stack status --json      # machine-readable state (containers, health, URLs)
just stack update             # rebuild and reload only the changed services (the `r` hotkey)
just stack update --frontend  # also rebuild the frontend bundle
just stack update --binaries-dir <dir>  # remount a prebuilt set; volumes stay
just stack down               # remove containers, volumes, and state
```

All the `run_local` flags apply to `stack` too. This includes `--instance`, `--no-doppler`, `--no-build`, and `--binaries-dir`.

The app is served at `<proxy>/app/`. The bundle resolves its backend from the origin it is served on. The same stack works on localhost or behind any hostname without a rebuild.

### Init Snapshots

`stack up` caches the expensive infrastructure initialization. The first cold run:

- Migrates the database
- Waits for the FusionAuth kickstart
- Creates the search indices

It saves these volumes as an init snapshot. The snapshot is content-addressed and stored under `infra/local/generated/.snapshots`. Later runs restore the snapshot and skip the initialization. An input change causes a cache miss and a normal full init.

Useful commands:

```bash
just stack up --no-snapshot   # skip the snapshot cache
```

Cursor Cloud bakes the snapshot during environment install. Later `stack up` restores it.

## Common Commands

Run local binaries against shared dev resources instead of a full local stack:

```bash
just run_dev
```

`run_dev` uses shared dev resources. It needs Doppler and real cloud access. It is for contributors with team access.

See what a running or stopped instance looks like. The output shows endpoints with live reachability probes, plus the state and host ports of every container. It does not start or rebuild anything:

```bash
just status_local
```

Stop an instance but keep its volumes:

```bash
just stop_local --instance agent-a
```

Remove the containers, volumes, and named-instance networks of an instance:

```bash
just destroy_local --instance agent-a
```

Drop, recreate, and migrate an instance database:

```bash
just reset_local --instance agent-a
```

For the default instance, omit `--instance`.
