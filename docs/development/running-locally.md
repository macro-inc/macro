# Running locally

This guide covers two ways to run Macro on your machine.

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

The Nix shell provides `just`, Cargo, the Rust toolchain, Bun, `wasm-pack`, sqlx, zig, cargo-zigbuild, `prek`, and `gitleaks`. You do not need to install these tools separately.

```bash
nix develop
```

Entering the shell installs git hooks (`prek install`). A pre-commit hook
scans staged added lines for customer emails, phones, addresses, and secrets.
See `tooling/pii/exceptions` and the `git` skill.

If `nix develop` fails, enable the experimental features:

```bash
nix develop --extra-experimental-features nix-command --extra-experimental-features flakes
```

Nix requires these experimental features to work. The command above enables them for one run. To enable them permanently, set this in `~/.config/nix/nix.conf`:

```
experimental-features = nix-command flakes
```

The default shell does not include the Tauri platform dependencies. They are large, so they live in their own shells. For Linux desktop development, use `nix develop .#tauri-linux`. For Android development on x86_64 Linux, use `nix develop .#tauri-android`.

For automated Linux desktop offline tests, use `nix develop .#tauri-e2e` and the
[native E2E guide](../../apps/web/tests/native/README.md). It runs the real Tauri
webview/native cache with deterministic API fixtures, without the local stack.

Run native app probes in their own memory-capped user scope, including inspector
and WebDriver reproductions. Renderer regressions can allocate enough memory to
terminate unrelated agents before a stalled probe times out:

```bash
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 \
  nix develop .#tauri-e2e --command <native-probe-command>
```


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

The first run, or a run after a wasm version change, may build wasm packages.
Vite detects your hostname and prints `https://<hostname>:3000/app/` when ready
(`PORT` overrides the port). It generates a certificate with the same stable
development CA as `just local`; trust `infra/local/certs/ca.pem` once on the
machine running the browser. See the [certificate README](../../infra/local/certs/README.md).
The visiting machine must resolve the hostname and reach that port. No Docker
proxy or Tailscale is needed. Vite forwards hosted development API and WebSocket
requests through `/__macro_dev/` on this same origin, so arbitrary machine
hostnames do not need to be added to the deployed CORS allowlist. Authentication
cookies are scoped to the visiting hostname; sign in with an email code on that
hostname rather than relying on an existing `.macro.com` cookie. Google/SSO
redirects still use the hosted authentication service’s redirect allowlist, which
does not currently include arbitrary development hostnames.

Use `MACRO_DEV_HTTPS=false bun run dev` for an HTTP-only workflow. Tauri and the
local stack's internal Vite server keep using HTTP automatically; the stack
provides HTTPS through its proxy. Builds and preview servers are unchanged.
`MACRO_DEV_PROXY=false` opts out of the hosted API proxy.

The dev server speaks HTTP/2, gzips module responses, and links each module's
source map (`/@macro-sourcemap/<hash>.map`) instead of inlining it; browsers only
fetch maps while DevTools is open. On a slow link this is the difference between
~100 MB and ~13 MB per load. Trust the CA rather than clicking through the
certificate warning: Chrome caches nothing from a site with a certificate error.
`MACRO_DEV_COMPRESSION=false` and `MACRO_DEV_INLINE_SOURCEMAPS=true` restore
Vite's defaults.

## Run the local stack

The local stack runs without Doppler. It runs Postgres, Redis, LocalStack, OpenSearch, Kafka, and FusionAuth in Docker, with dummy AWS credentials and fixed test secrets.

The local stack runs on Linux. The Nix dev shell supplies the Docker CLI, daemon, Compose, and `fuse-overlayfs`. Nix is the only host dependency.

The service binaries are built natively and link the Nix shell's libraries, so a macOS build can't run in the stack's Linux containers. On macOS, `run_local` and `stack up` stop before building and say so; for frontend-only work, [run the frontend against hosted services](#run-the-frontend-against-hosted-services).

The first build in a checkout or worktree runs `bun install --frozen-lockfile`
at the repository root and in `packages/sdk` when either has no `node_modules`:
a Rust build script bundles the SDK from them.

Run the preflight check before the first start:

```bash
just doctor-local
```

The check tests the Docker daemon, the toolchain, and the required ports, and names instances left holding ports or subnets. It reports any problem and suggests a fix. If a start fails, run the check again.

Run this command from the repository root if you do not have Doppler access:

```bash
just run_local --no-doppler
```

The local stack does not need Doppler. It uses the code-defined local configuration with dummy AWS credentials and fixed test secrets. Most contributors are not on the team, so this is the common path.

Local authentication includes a working signing key pair for Macro API tokens,
which settings actions such as enabling CRM require. New teams start with CRM
disabled; enable it in Settings > CRM before creating pipelines.

The stack supplies stubbed values for required configuration, including third-party integrations (GitHub, Stripe, CloudFront). Those flows do not work against real services with the stubs. Local auth, documents, and search work independently. Google is the exception: without a real Google OAuth client the stack runs the [Gmail emulator](#google-sign-in-and-gmail-without-a-google-account) in Google's place, so Google sign-in, Gmail linking and mail sync work with seeded users.

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

In a terminal it stays attached with hotkeys. Without one (an agent's shell, a pipe,
CI), it runs in the background and returns once the stack is ready. See
[Run without a terminal](#run-without-a-terminal).

The reverse proxy is HTTPS at `https://localhost:8090` (or the instance's proxy port) using a generated machine certificate signed by the checked-in development CA. Trust `infra/local/certs/ca.pem` once so the browser accepts it; see that directory's README. Local Caddy also reflects any `Origin` (wildcard CORS) so `https://` and `*.localhost` frontends can call the proxy.
For document sync, local Caddy normalizes the upstream `Origin` to the worker's
accepted localhost origin so HTTPS machine hostnames can open WebSockets.
Sync's local Durable Object, KV, R2 and D1 state lives in the Compose `sync_state`
volume so replacing its container preserves document content. When upgrading an
existing stack without that mount, stop sync and copy `/app/.wrangler/state` into
the volume before replacing the container. A restart alone does not rebuild its
compiled worker; rebuild the sync image after backend protocol changes.

Open the frontend URL in your browser.

The local environment supplies both `LOCAL_AWS_URL` (the container endpoint)
and `LOCAL_AWS_PUBLIC_URL` (this machine's hostname on the proxy port, with
`/local-storage`, in both the hot and the static-frontend flavor).
Document downloads and presigned uploads use this storage proxy, so remote
browsers do not need a separate localhost storage connection. Container clients
translate that public endpoint back to LocalStack internally. If a download or
upload still attempts HTTP localhost, rebuild the services, reload the generated
environment and proxy, and hard-refresh the browser to discard cached URLs.

Static-file permalinks also use the
machine's HTTPS proxy hostname at `/static-file`. This applies to headless
stacks too, so a remote browser can load images even when the local frontend
origin is localhost.

If LocalStack loses its temporary resources after a restart, restore missing
buckets, queues, tables, and keys without resetting Postgres or volumes:
`cargo x localstack-provision --instance <name>`. This restores resources, not
lost objects.

The stack does not create accounts in advance. Passwordless login creates a user
on demand. Register with any email address. FusionAuth sends you a one-time code
by email. That email lands in **Mailpit** at http://localhost:8025, not in a real
inbox.

### Google sign-in and Gmail without a Google account

A stack whose environment names no real Google OAuth client (`--no-doppler`
without Google keys in `--env-file`) starts the Gmail emulator
(`crates/gmail_emulator`) as the `gmail_emulator` service. FusionAuth's `google`
and `google_gmail` identity providers and the services' Google URLs
(`OVERRIDE_GMAIL_API_URL`, `OVERRIDE_GOOGLE_OAUTH_TOKEN_URL` and the rest, in
`xtask_local`'s `google_emulator.rs`) point at it. Nothing talks to Google.

- **Continue with Google** opens the emulator's page in place of Google's. Pick
  one of the seeded users (`ada@example.com`, `bob@example.com`,
  `carol@example.com`, from `crates/gmail_emulator/seed.example.yaml`). A first
  sign-in creates the Macro account and connects that user's mailbox.
- **Connect another account** in Email, and the email steps of onboarding, open
  the same page; pick another seeded user to add their mailbox.
- The page and the emulator's control API are at the `gmail_emulator` port,
  `http://localhost:8480` on the default instance and the window's port on a
  named one (`docker compose port gmail_emulator 8080`). Add users and mail
  while the stack runs with `POST /_emulator/seed`; deliver new mail with
  `POST /_emulator/mailboxes/{email}/messages`. See the crate's `AGENTS.md`.
- Like FusionAuth's own pages, the sign-in page is addressed as `localhost`,
  so sign in with Google from a browser on this machine.
- The emulator keeps its state in memory: restarting its container returns it
  to the seed, while Macro's database keeps what it synced.
- FusionAuth only gets the emulator's identity providers when its database
  is first filled. A stack created before the emulator existed, or with
  different Google keys, stops at "Waiting for FusionAuth" and says so:
  start it once with `--fresh`.
- The emulator is also those users' Google Calendar: the seed file gives them
  calendars with repeating events, the calendar service syncs them, and the
  emulator pushes each change to its webhook. Put an event on a calendar with
  `POST /_emulator/mailboxes/{email}/calendars/primary/events` (Google's event
  resource). A mailbox added through **Connect another account** gets calendar
  sync. One connected only by signing in does not yet: the email service reads
  that grant's scopes from Google's token-info endpoint, which is not behind a
  service URL override.

With real Google keys the emulator does not start and Google is used as before.

`just local-e2e-email` starts an isolated stack this way (instance
`local-e2e-email` unless `LOCAL_E2E_INSTANCE` names one; the recipe passes its
arguments to Playwright) and runs the email Playwright suite
(`apps/web/tests/e2e/local-email.config.ts`) against the stack's frontend: each
spec signs in with Google as a seeded user and delivers mail through the
emulator's control API. Sync behavior that needs no browser is specified in
process instead, in `email_service`'s `pubsub::emulated_inbox`.

### Microsoft sign-in and Outlook without a Microsoft account

A stack whose environment names no real Microsoft OAuth client
(`MICROSOFT_CLIENT_ID` absent from Doppler and `--env-file`) starts the Outlook
emulator (`crates/outlook_emulator`) as the `outlook_emulator` service.
FusionAuth's `microsoft` identity provider and the services' Microsoft URLs
(`OVERRIDE_MICROSOFT_GRAPH_URL`, `OVERRIDE_MICROSOFT_LOGIN_URL`,
`OVERRIDE_MICROSOFT_LOGIN_PAGE_URL`, with the emulator's OAuth client and the
Outlook switches, in `xtask_local`'s `microsoft_emulator.rs`) point at it.
The authentication service runs without a PostHog key there, so
`OUTLOOK_CONNECTIONS_ENABLED` alone admits new Outlook connections, not the
`enable-outlook` flag. Nothing talks to Microsoft.

- **Continue with Microsoft** opens the emulator's page in place of Microsoft's.
  Pick one of the seeded users (`ada@example.com`, `bob@example.com`,
  `carol@example.com`, from `crates/outlook_emulator/seed.example.yaml`). A first
  sign-in creates the Macro account.
- **Connect Outlook**, in onboarding and in Email, opens the same page; pick a
  seeded user to connect their mailbox. Sign-in and the mailbox are separate
  grants, as with Microsoft, so a Microsoft sign-up connects its mailbox in the
  onboarding email step.
- The page and the emulator's control API are at the `outlook_emulator` port,
  `http://localhost:8481` on the default instance and the window's port on a
  named one (`docker compose port outlook_emulator 8080`). Add users, mail and
  calendars while the stack runs with `POST /_emulator/seed`; deliver new mail with
  `POST /_emulator/mailboxes/{email}/messages`. See the crate's `AGENTS.md`.
- Like FusionAuth's own pages, the sign-in page is addressed as `localhost`,
  so sign in with Microsoft from a browser on this machine.
- The emulator keeps its state in memory: restarting its container returns it
  to the seed, while Macro's database keeps what it synced and the refresh
  tokens it holds stop working. Reconnect the mailbox after a restart.
- Change notifications are not delivered: Graph subscriptions need an HTTPS
  webhook, and the stack's services reach each other over HTTP. Mail that
  arrives at the emulator later shows up with the next sync, not at once.
- A connected mailbox's Outlook calendars sync from the emulator too: the
  seed gives Ada and Bob calendars with repeating events, and events created
  or changed in Macro are written to the emulator. The calendar service polls
  every two minutes, so a change made in the emulator
  (`POST /_emulator/mailboxes/{email}/calendars/default/events`) shows up
  with the next poll.

With a real Microsoft client in the environment the emulator does not start.
Sign in with Microsoft is then unavailable locally, as before: the stack defines
no `microsoft` identity provider for a real client.

### Recover an existing instance without resetting data

`just run_local --detach --instance <name>` brings an existing instance back up over
its volumes. It starts stopped containers, applies new migrations, restores
LocalStack, reloads rebuilt services, and restarts Vite. An attached `run_local`
and `stack up` start from clean state instead, so don't use those to recover an
instance whose application or auth data must survive. Never use `down -v`,
`reset_local`, or `destroy_local` for this recovery.

To touch only the affected services, keep the instance's generated env/Compose files
and recreate them with the same Compose project/files and
`up -d --no-deps --no-build <service>`.

Local stacks give every service `RUST_MIN_STACK=16777216`, because debug
builds can exhaust the default 2 MiB thread stack. If a local debug service
still aborts with `tokio-rt-worker` stack overflow, verify the request that
triggered the crash, not just the health endpoint: document storage can start
successfully and then exhaust its worker stack on a Soup request.

On SELinux hosts, FusionAuth can become healthy while silently skipping an
unreadable kickstart. The generated per-instance kickstart directory uses
`:ro,Z`: read-only with a private container label. Regenerate the override with
`cargo x gen-compose --instance <name>`, then recreate only FusionAuth against
its existing volumes. Verify the kickstart is readable in the container and the
configured application API returns 200 with the local API key; a healthy process
alone does not prove kickstart ran. Do not disable SELinux, change host permissions,
or delete the FusionAuth database. Diagnose other bind-mount denials separately;
private labels must not be applied to directories shared by several containers.

For the synthetic Slack recovery harness and separate browser/native coverage,
see [the Slack import runbook](../runbooks/slack-archive-import.md).

### Seeding sample data (recommended)

A bare stack has no content to click through. The seed CLI creates a realistic
world: users, teams, channels, projects, documents, tasks, chats, calls, emails,
and messages. The world uses realistic permissions.

From the repository root, after the stack is up:

```bash
just seed-scenario apply --file seed/scenarios/team-perms.json
```

`apply` creates a FusionAuth account for each persona. It prints a login link per
persona, for example `https://alice.localhost:8090/app/login?email=alice@seed.macro.local`.
Open each link in a plain browser tab. Each persona hostname has its own cookie
jar. You can drive several personas side by side against one stack, whether it
is attached or headless.

Useful commands:

- `just seed-scenario status --file seed/scenarios/team-perms.json` — show what is seeded and re-print the login links.
- `just seed-scenario reset --file seed/scenarios/team-perms.json` — remove the scenario's rows and its user accounts by email.
- `just seed-scenario matrix --file seed/scenarios/team-perms.json` — check the expected access level for every user and entity pair against the live database.

`apply` touches only rows that carry the scenario `5eed` id marker, plus the
persona accounts it created. It is safe to run against a stack that you tested in.

## Integration Secrets

Passwords uses a local OpenBao server with team-scoped namespaces and single-node
integrated Raft on a named Compose volume per instance. Startup initializes it once
and unseals it automatically with a generated local seal key. Provision each new team
using the [local vault bootstrap](../../infra/local/openbao/README.md); container
and stack restarts preserve credentials, TOTP seeds, and provisioning without a
reseed. Keep the volume and seal key together, and use synthetic credentials only.
Migrating from the old in-memory development server requires restoring its values
once; Postgres metadata alone cannot recover them. Do not reset Postgres or remove
other stack volumes for that migration.

For non-destructive restarts use `docker compose restart` with the instance's
project and Compose files, or Compose `down`/`up` without `--volumes`. The xtask
up/down paths can reset metadata or remove volumes, and stack init snapshots do
not include the vault.

A `--no-doppler` stack supplies deterministic stubs for required configuration. External integrations still need real values, except Google, which the Gmail emulator stands in for:

| Integration | Keys | Stub behavior |
| --- | --- | --- |
| Google login / Gmail | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET_KEY` | The Gmail emulator answers in Google's place: Google sign-in and Gmail linking work with its seeded users, never a real account. Real keys (a `GOCSPX-` secret) switch the stack to Google. |
| Pipedream | `PIPEDREAM_CLIENT_ID`, `PIPEDREAM_CLIENT_SECRET`, `PIPEDREAM_PROJECT_ID` | Placeholders satisfy the harness configuration loader; Pipedream integrations require real credentials. |
| Microsoft login / Outlook | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` | The Outlook emulator answers in Microsoft's place: Microsoft sign-in, Outlook linking and Outlook calendar sync work with its seeded users, never a real account. A real client id switches the emulator off. |
| GitHub login | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_IDP_ID` | Login with GitHub is unavailable |
| Stripe billing | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` | Checkout and subscription endpoints fail. Signup skips Stripe and leaves profile billing unset, so free-team creation works. Only the required legacy account field stores a local placeholder. |
| CloudFront signed URLs | `DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_DISTRIBUTION_URL`, `DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID`, `DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY` | Document download URLs are unsigned (fine against local S3) |

The other stubbed keys (`REDIS_HOST`, `MACRO_DB_URL`, `INTERNAL_API_KEY`, `AUTHENTICATION_SERVICE_SECRET_KEY`, `ACCOUNT_LINK_STATE_SECRET`, `OPENSEARCH_USERNAME`, `OPENSEARCH_PASSWORD`) are internal plumbing with correct local values — you never need to override them.

To turn on an integration, create a `local.env` with the real values. Then pass it
to `run_local`:

```bash
just run_local --no-doppler --env-file ./local.env
```

Keys in the file override the code-defined defaults, so you only need to list the integrations you care about. With Doppler access, `just run_local` (without `--no-doppler`) supplies everything automatically.

## Tracing, Logs, and the Debug Browser

Local service console logs rotate at 20 MB per file and retain three files per
container. The limits apply when a container is created; recreate older
containers with the existing Compose project/files to adopt them. Repeated
worker errors still need their underlying dependency or configuration fixed.

`just run_local` and `just stack up` support two global (per-machine, shared
across instances) debugging containers:

- **LGTM collector** (`--traces lgtm`, the default): Grafana at
  http://localhost:3001 with Tempo (traces), Loki (service logs), and
  Prometheus behind it. Rust services export spans and `tracing` events over
  OTLP; the frontend exports browser spans through the proxy and propagates
  `traceparent`, so one trace covers browser → proxy → services. Swap with
  `--traces jaeger|datadog`, or disable with `--traces off`. A running
  collector is reused as-is and never recreated, so other stacks keep their
  network attachments to it; to pick up a changed compose definition, run
  `docker rm -f macro-lgtm-1` and start a stack again.
- **Agent browser** (opt-in via `--with-chrome`): Chromium with the DevTools
  protocol on http://localhost:9222, for agents driving the app (the
  `chrome-devtools` MCP server in `.mcp.json` / `opencode.json` /
  `.cursor/mcp.json` points at it). Watch what an agent is doing live at
  http://localhost:6080/vnc.html.

Older local-tool builds can recreate the shared LGTM collector and drop other
stacks' network attachments. For a static frontend refresh, reuse the
complete recorded binary set with `just stack update --frontend --binaries-dir
<recorded-dir> --instance <name>` to avoid backend builds and collector startup.
`--traces off` skips collector startup, omits automatic backend OTLP wiring,
and disables Vite browser telemetry and the local Docker sync-service exporter.
For both local and dev runs, the resolved tracing policy owns
`SYNC_SERVICE_OTEL_EXPORTER_OTLP_ENDPOINT`: it is empty when tracing is off or
no collector is available, and uses the collector's HTTP intake when enabled.
The Compose launcher removes an inherited shell value for this key so its
explicit generated env file remains authoritative. The Docker worker forwards
the resulting value through Wrangler `--var`; direct Compose defaults to an
empty endpoint, with no fallback hostname. Deployed Worker settings are separate.
When collecting trace proof, enable tracing and connect the existing collector
to the instance's services network with the `otel-collector` alias, without
restarting it.

See `.agents/skills/live-debug/SKILL.md` for query recipes (Tempo/Loki HTTP
APIs) and the browser-debugging workflow.

For agent turns, use Tempo's TraceQL query
`{span.gen_ai.operation.name="invoke_agent"}`. The session actor records the
ACP prompt, output and tool activity on that trace and sends its context in
`params._meta["macro.dev/trace-context"]`. Macro's in-process runtime restores
that context so its model calls and backend work appear in the same trace.
Other runtimes must explicitly consume this metadata to correlate their
internal spans; their ACP activity is still traced by the session actor.

GenAI content is bounded by `genai_telemetry`; check
`macro.genai.content_truncated` before using a span for evaluations.

## Control the Running Stack

While `run_local` is attached:

- Press `r` to rebuild the changed Rust services and reload them.
- Press `f` to restart Vite with the same frontend port and configuration. This
  also recovers a stuck frontend reload and leaves backend services and data intact.
- Press `q` to stop the stack and exit.

Use `q`, not the terminal close button. `q` stops and removes the containers at once. The next start does not have to clean up a stale stack.

## Run without a terminal

`just run_local` needs no terminal. Without one on both stdin and stdout, or with
`--detach`, a background process does the bring-up and then holds Vite. The command
you ran only streams its log and exits with the result, so it works from an agent's
Bash tool. The stack, and a bring-up or rebuild still in progress, survive that call
timing out, its shell being killed, and the `nix develop` that launched it.

```bash
just run_local --instance <name>                # returns once ready; nonzero names the failed step and log
just run_local status --instance <name> --json  # phase, health, URLs, last job, containers
just run_local wait --instance <name>           # block until a running bring-up or rebuild ends
just run_local rebuild --instance <name>        # the `r` hotkey: rebuild changed services and reload them
just run_local rebuild --services contacts_service --instance <name>  # rebuild and reload only these
just run_local restart-frontend --instance <name>  # the `f` hotkey
just run_local logs --instance <name>           # the last job's log
just run_local logs --service frontend --instance <name>  # Vite; any compose service name works
just run_local stop --instance <name>           # stop everything, keep the data
```

Run these inside `nix develop`, or prefix each with `nix develop --command`. They also
work from another shell against an attached `run_local`, where `rebuild` is
the same as pressing `r`.

The orchestrator itself compiles in the foreground, into `target/xtask`, so control
commands answer at once while a service build holds `target/debug`. That first
compile can take minutes in a fresh worktree. If your call is killed during it,
nothing has started yet: run it again.

Repeating the start command is safe:

- A healthy instance is left alone.
- A bring-up or rebuild already running is waited for.
- A stopped or failed instance comes back over its existing volumes, keeping its data.
- `--fresh` deletes the data and starts clean. An attached start always does, so a
  person at a terminal gets a clean slate and an agent never wipes by accident.

The frontend is Vite, so edits under `apps/web` apply on save. Add `--static-frontend`
to serve a built bundle from the proxy instead (a browser on an unstable network may
never finish loading Vite's thousands of modules). Then pick up frontend edits with
`just run_local rebuild --frontend`.

| `wait` or start exit code | Meaning |
| --- | --- |
| 0 | Finished. |
| 1 | Failed. The last line names the step and the log. |
| 3 | `wait --timeout <seconds>` gave up. The job is still running; call `wait` again. |

`phase` in `status --json` is one of:

| Phase | Meaning |
| --- | --- |
| `starting` | A bring-up is running. |
| `ready` | The backend answers through the proxy and the frontend answers. |
| `degraded` | Containers run, but the backend or frontend doesn't answer. Check `job`, `services`, and `frontend_healthy`; `just run_local` restarts a dead Vite. |
| `failed` | The last bring-up failed or was killed. `job.failed_step` says where (for an error between steps it is null and `job.step` is the last step that ran), and `job.log` holds the output. |
| `stopped` | No container is running. The data is kept. |
| `unrecorded` | Containers run, but no flow recorded a stack. `just run_local` adopts it and keeps its data. |

A failed `rebuild` leaves the old build running: the phase stays `ready`, and `job`
records the failure. Run state and logs live in `infra/local/generated/<instance>/run`.

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

You don't pick ports or subnets. In its first second, before any build, a start
reserves a free port window and a free `10.254.<n>.0/24` for its four Docker
networks, under a machine-wide lock, so parallel starts can't collide. A name
gets the same window every run unless something else is on it. An instance with
containers keeps its window and networks, including ones created before this
allocator or with `--port-base`. Other commands find the window themselves, so
repeat only `--instance`. Startup prints the window; `just status_local` and
`just stack status --json` print the endpoints.

Local signup and onboarding screens provide **Bypass** for any account. Before
signup it skips the opening slides, not authentication; after sign-in it records
both onboarding and tutorial completion. See the
[onboarding guide](../agent-guide/onboarding.md#onboarding-bypass--apponboarding).

If a program outside this tooling takes a port during the build, the start moves
to another window instead of failing at `docker compose up`.

Pin a window only when something needs it fixed. A pinned window that isn't free
fails straight away:

```bash
just run_local --instance agent-a --port-base 23000
```

Quitting with `q`, `just stack down`, and `just destroy_local` free the instance's
networks and allocation. `just stop_local` keeps them, so a stopped instance
still holds its window and subnet. `just doctor-local` names instances holding
them with nothing running. It removes nothing, because they may be someone's data.

Allocations in progress are recorded in `~/.local/state/macro-local/`. The file
holds nothing Docker doesn't: entries for instances with no Docker resources and
no running owner are dropped at the next start.

The generated files for an instance live here:

```text
infra/local/generated/<instance>
```

Instances on one machine do not share sessions, even though browsers ignore the
port when they scope cookies. The HTTPS proxy stores each instance's cookies
under its own prefix, after any `__Host-` or `__Secure-`
(`macro-<instance>--local-macro-access-token`,
`__Host-macro-<instance>--macro_mcp_oauth`). It forwards a service only that
instance's cookies, under their real names, so services and the app behave as
usual on `localhost`, the machine hostname, a tailnet name, or a tunnel. Every
other cookie stays in the browser: other instances' cookies, and unprefixed ones
such as tokens from older stacks or a service's own host port, which no instance
can claim, and cookies the app's JavaScript sets, which no service reads. That
includes the SSO callback on the auth service's own port, so SSO against a local
stack hands the app a session code, which it redeems through the proxy. `run_dev`
keeps hosted-style cookies and the usual SSO return.
localStorage and IndexedDB were already separate, since they key on the port.

An existing stack keeps its data. `just stack update` recreates its proxy with
these rules; sign in once more afterwards. A client that calls the proxy with a
hard-coded cookie name should send `Authorization: Bearer` instead or use the
prefixed name. FusionAuth's own cookies stay unprefixed, as its port is published
directly; they only hold its hosted-login session, not your Macro session.

After changing the cookie rules (`cookie_rewrites` in `xtask_local`'s
`proxy.rs`), also run them in a real Caddy, which CI doesn't have: from
`tooling/xtask`, `nix shell nixpkgs#caddy -c cargo test -p xtask_local -- --ignored real_caddy`.

### Access a remote dev server through one URL

`just local` (the `run_local` alias) and `run_dev` call `hostname`, add that
name to Vite's allowed hosts, and issue a certificate for it using the stable
CA in `infra/local/certs`. Startup prints `https://<hostname>:<proxy-port>/app/`.
Caddy serves backend routes directly and forwards frontend assets and HMR to
Vite, so the browser only needs the HTTPS proxy port.
Login fallback redirects, Pipedream origins, MCP callbacks, and file permalinks
use that same HTTPS origin for attached local stacks.
If your host firewall blocks Docker-to-host traffic, allow the instance's
Docker network to reach the Vite port through `host.docker.internal`.
Startup verifies `/app/` through the HTTPS proxy before printing “ready”;
a listening Vite port alone is insufficient. Persistent 502s with proxy logs such
as `dial tcp <host-gateway>:<vite-port>: i/o timeout` can indicate this firewall
path is blocked. Firewall rules must cover the current instance's Docker network
and frontend port, which can differ between instances.

If `/app/` succeeds but the page stays blank, inspect script requests as well as
API requests. Intermittent 502s for Vite modules can come from the burst of
Docker-to-host connections during startup. The generated proxy limits Vite to
16 upstream connections so module requests queue instead of exhausting the host
listener. After applying an updated proxy configuration, restart only the
instance's proxy and reload the page; existing databases and volumes can stay.

Trust `infra/local/certs/ca.pem` in the visiting browser once (see the
[certificate README](../../infra/local/certs/README.md)), then open that URL.
The visiting machine must resolve the hostname and reach the proxy port over
your network. Tailscale is not required. The generated certificate also covers
`localhost`, `*.localhost`, `127.0.0.1`, and `::1`. Other aliases require a
matching certificate and a Vite allowlist entry; arbitrary names are not
accepted automatically.

An SSH forward to the HTTP Vite port still works for localhost-only access:
`ssh -N -L 3000:127.0.0.1:20110 your-dev-host`, then open
`http://localhost:3000/app/`. HMR follows the page's host, port, and protocol.

The launcher sets `VITE_LOCAL_BACKEND_ORIGIN=same-origin` and supplies Vite's
server-only `MACRO_LOCAL_BACKEND_PROXY` and `MACRO_LOCAL_BACKEND_ROUTES` from the
selected instance and backend inventory. The proxy preserves paths, query
strings, cookies, streaming responses and WebSocket upgrades. AI-editing and
enabled browser telemetry also use same-origin paths. Bare `bun run dev` without
these variables still uses hosted services; `TAURI_DEV_HOST` remains an explicit
native HMR override. Keep local dev stacks private: same-origin routing does not
add authentication or make passwordless local login safe to publish.

The launcher sets `NODE_EXTRA_CA_CERTS` for Vite so its HTTP and WebSocket
forwarding verifies the backend certificate. Plain HTTP on a remote hostname
cannot retain the app's secure login cookies; use the printed HTTPS URL.

The stack launches Vite directly with Node (available in the Nix shell), because
Bun's Node HTTP compatibility currently hangs on Vite's proxied WebSocket
upgrades. Bun is still used for dependency installation and builds.

## Macro Computers

`agent_harness_service` runs the Macro computer control plane when
`COMPUTERS_FLEET` is `incus` or `docker`. The stack sets every `COMPUTERS_*`
value from the fleet you pick. An enabled fleet requires explicit configuration;
missing values fail startup with the variable name. With no attached fleet, omit
`COMPUTERS_FLEET` and every `COMPUTERS_*` setting. Local orchestration emits none when
computers are off. Each enrollment carries a typed deployment (agent harness,
document storage, app and egress URLs) that the harness resolves through
`macro_service_urls` when it issues the enrollment; xtask sets the harness's
`OVERRIDE_*` values to the addresses the fleet's guests reach.

`COMPUTER_RETENTION_DAYS` (default `14`) and `COMPUTER_PAST_DUE_GRACE_DAYS`
(default `7`) set Macro computers' retention and past-due grace in both
authentication_service and agent_harness_service; set them only to override.

Harness config required for either fleet:
`COMPUTERS_CONTROL_PLANE_ID`, `COMPUTERS_HOST_NAME`, `COMPUTERS_IMAGE`,
`COMPUTERS_HOST_RESERVE_GB`, and `COMPUTERS_OVERSELL_FACTOR`.
Local orchestration supplies reserve `7` GB and oversell factor `3` for both
fleets. The Docker image is `macro-box:latest`; for Incus set
`COMPUTERS_INCUS_IMAGE` to the versioned alias imported on `runtime-dev-1`
(`macro-box/<version>`, see [`nix/macro-box/AGENTS.md`](../../nix/macro-box/AGENTS.md));
xtask fails when it is unset.

Docker additionally requires `COMPUTERS_DOCKER_NETWORK`,
`COMPUTERS_DOCKER_ENROLLMENT_DIR`, and `COMPUTERS_DOCKER_MEMORY_GB` (`32` locally).
Incus additionally requires `COMPUTERS_INCUS_URL`,
`COMPUTERS_INCUS_CLIENT_CERT`, `COMPUTERS_INCUS_CLIENT_KEY`,
`COMPUTERS_INCUS_SERVER_CERT`, and these explicit settings:

| Variable | Local value |
| --- | --- |
| `COMPUTERS_INCUS_PROFILE` | `macro-box` |
| `COMPUTERS_INCUS_STORAGE_POOL` | `default` |
| `COMPUTERS_INCUS_REQUEST_TIMEOUT_SECS` | `90` |
| `COMPUTERS_INCUS_CONNECT_TIMEOUT_SECS` | `10` |
| `COMPUTERS_INCUS_OPERATION_WAIT_SECS` | `60` |
| `COMPUTERS_INCUS_OPERATION_WAITS` | `15` |
| `COMPUTERS_INCUS_STATE_CHANGE_TIMEOUT_SECS` | `60` |
| `COMPUTERS_INCUS_SHUTDOWN_GRACE_SECS` | `60` |

Authentication does not read a fleet selector. It resolves physical attachment on
every computer HTTP request from the owning host heartbeat (fresh within five
minutes); without attachment these routes answer typed 503 before reads, billing
or queued effects. The operator refreshes its heartbeat at startup and every
60-second reconcile pass. PostHog `enable-macro-computers` is the only product
rollout gate. Absent attachment is not a feature switch.

Configure all six
`STRIPE_COMPUTER_{STANDARD,LARGE,XL}_{MONTHLY,YEARLY}_PRICE_ID` values or none;
partial groups and malformed IDs fail startup and Doppler validation even without
a fleet. Preserve configured prices when detaching a fleet: billing cleanup and
reconciliation still need them. Pure catalog/spec access does not require prices
or attachment. No size or interval receives a fallback price. Local Doppler supplies test-mode prices.
`--no-doppler` supplies explicit
placeholder price IDs for startup only; replace them with real test prices
before buying a computer.

Provision the same required keys in each service's deployment Doppler config
before enabling a fleet there. Request/connect/operation/state-change/shutdown
deadlines are infrastructure config; lifecycle retention, retry and
reconciliation timings remain named policy constants.

Select a fleet with:

| Flag | Fleet | Computers run on |
| --- | --- | --- |
| none (`run_local`), `--computers docker` | `docker` | this machine's Docker daemon |
| `--computers-incus`, `--computers incus` | `incus` | VMs on `runtime-dev-1` |
| `--no-computers`, `--computers off`, none (`stack up`) | off | nowhere; no control plane |

`stack up` defaults to off so agents and CI do not build the computer image;
`stack update` keeps the fleet `up` recorded. `run_dev` never runs computers.

### Docker (default)

`run_local` builds the image with `nix build .#macro-box-docker` and loads it
as `macro-box:latest`. Nix caches the build, and the load only runs again when
the store path or the daemon's image changes
(`infra/local/generated/.macro-box-image`). The first build is slow; pass
`--no-computers` to skip it.

Computers are privileged `macro-box` containers named `macro-computer-<id>`
on the instance's `<project>_services` network, so macrod dials the agent
harness, document storage, and auth in-network. The harness drives the daemon
through the Docker socket it already mounts for sandboxes. Enrollments are
written to `infra/local/generated/<instance>/computers/enrollments`, which is
mounted into the harness at the same absolute path, because the daemon resolves
bind sources on the host. The harness writes them as root. Each computer's
`/home` and `/var/lib/macrod` are named volumes (`macro-computer-<id>-home`,
`-macrod`), like an Incus computer's data disk; releasing the computer
deletes them. Starting the stack again removes the
instance's computer containers and volumes along with its data.

Computers use a separate local-only HTTP listener on the same Caddy proxy:
`http://proxy:<ComputerGateway port>` inside Docker. Incus guests use the devbox's
tailnet address and the published host port; the browser keeps its HTTPS origin. This
avoids guest host-DNS entries, importing the local TLS CA, or bypassing TLS.
`OVERRIDE_CONNECTION_GATEWAY_WEBSOCKET_URL` uses `ws(s)`;
`OVERRIDE_MCP_SERVICE_URL` is a service base (the consumer appends `/mcp`).
Regenerate the instance env and Compose config after changing fleets or URL
mappings. A recreate consumes the current deployment addresses and fresh credentials.

### Incus on runtime-dev-1

```bash
COMPUTERS_INCUS_IMAGE=macro-box/<version> just run_local --instance computers --computers-incus
```

This path is currently unavailable: `runtime-dev-1` no longer joins a tailnet
(it serves the hosted dev control plane over WireGuard; see
[`nix/hosts/README.md`](../../nix/hosts/README.md)). It needs the devbox and
runtime logged into the same Tailscale tailnet.
`tailscale ip -4 runtime-dev-1` must return an IPv4 address before startup;
xtask fails loudly if it cannot resolve one. Set `COMPUTERS_INCUS_ADDRESS=<IPv4>`
to override discovery. Compose receives the numeric
`COMPUTERS_INCUS_URL=https://<runtime-tailnet-ip>:8443`, so it needs no MagicDNS
and no socat/IAP sidecars.

This needs the control-plane identity
`~/.config/macro-computers/dev-client.{crt,key}` (see
[`nix/hosts/README.md`](../../nix/hosts/README.md) for enrollment, rebuild,
firewall rules and IAP recovery). On first use xtask fetches the server
certificate over Tailscale into `~/.config/macro-computers/dev-server.crt`,
verifying the pinned SHA-256 fingerprint before saving it and on every start.
The Incus client pins the certificate bytes, so SAN/name mismatch is expected
and does not weaken verification.

Enrollment stores the fleet-reachable egress URL in macrod’s config. Computer
sessions use it for first-party MCP servers and the Anthropic gateway, while
other paired runtimes keep the stack’s external egress URL.

Boxes reach the stack directly over the devbox tailnet address, resolved once
at stack start with `tailscale ip -4`. Missing, ambiguous, or non-tailnet output
fails startup. This address must match the runtime's
`macro.computers.controlPlaneAddress` (`100.116.73.13` in the checked-in config).
The runtime permits only the control-plane TCP host ports (agent egress, harness,
document storage, auth, computer gateway, connection gateway) and
masquerades them to `tailscale0`; other tailnet destinations are dropped.
Cognition and scheduled actions keep their harness route prefixes; MCP is the
harness service base, and the connection endpoint uses `ws`. The launcher uses
the same direct devbox address for the API gateway URL. Reused
harness ports are emitted once in the host-port list; each of the default and
120 standard named windows is checked against the evaluated Nix allowlist.
Custom `--port-base` values need a matching `controlPlanePorts` option update.
The devbox firewall must accept those ports from the runtime's tailnet address;
see the exact INPUT and Docker forwarding rules in the host README.

Existing VMs survive stack database replacement; handle their cleanup explicitly.


Check the generated wiring without starting anything:

```bash
cargo x validate-local-compose --instance computers --computers-incus
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

A named instance doesn't have this problem: it gets a window with every port free.
You do not need to kill the other process:

```bash
just run_local --no-doppler --instance test
just seed-scenario --instance test apply --file seed/scenarios/team-perms.json
just status_local --instance test
```

The default instance (no `--instance`) always uses the fixed ports. If one is
taken, its start fails before the build and names the ports.

The seeded persona login links embed the proxy port. If an instance's window
moves, run `just seed-scenario apply` again to get links that match.

## What the Stack Rebuilds

Local service builds inherit `RUSTC_WRAPPER`, including an empty value to disable
compiler caching.

The Rust services are built on the host with one `cargo build` in the Nix shell, into `target/debug`, the same directory `cargo build` and `cargo test` use. The binaries are mounted into a shared runtime image together with `/nix/store`, which holds the loader and libraries they link. Docker does not compile these services during a normal `run_local`. `cargo x build-services` runs the same build on its own.

A Nix garbage collection can delete libraries a running stack's binaries use; rebuild with `r` or `just stack update` if a service then fails to start.

A new worktree's first build reuses the registry dependencies another worktree on the machine already compiled. After a build, those dependencies are copied to `~/.cache/macro/local-deps/<key>` (override with `MACRO_LOCAL_DEP_CACHE_DIR`). The key covers `Cargo.lock`, the toolchain, the build arguments and the compiler flags. A build into a `target/` that has none of those dependencies yet, as in a new worktree, copies the matching entry in first and compiles little more than the workspace crates. A `target/` that already built some of them is left alone, since crates built in different worktrees can't be mixed. xtask builds itself into `target/xtask` so that it doesn't count. Cargo still checks every copied unit, so a stale one is rebuilt rather than used. The three most recently used entries are kept, at about 7 GB each. Delete the directory to drop them.

Press `r`, or run `just run_local rebuild`, to rebuild the binaries. Only services
whose binary is newer than their container restart, so a build that failed partway
still gets its finished services reloaded next time.

To rebuild only the services you are working on, pass `--services` with compose or
binary names, comma-separated: `just run_local rebuild --services contacts_service`
or `just stack update --services contacts_service,email_service`. An edit to a crate
most services share then rebuilds in seconds instead of minutes, but the other
services keep running the code they were last built from. `status`, `status --json`
(`stale_services`) and the rebuild output list every service whose crates changed
since its own last build, with the command that rebuilds them all. A full rebuild
(`r`, or either command without `--services`) clears the list.

Three services have Docker-built images:

- `sync_service`
- `lexical_service`
- `websocket_service`

`sync_service` and `lexical_service`, like the local OpenSearch image, run under tags keyed by the content of what their build reads (the sync worker's cargo dependency closure; the JavaScript workspace manifests, lockfile, shared `packages/` and the lexical service). A start whose inputs changed builds the new image; otherwise every instance and worktree on the machine shares the one already built, so an unrelated edit no longer costs a new instance a minute or two of image builds. Tags over three days old that no container uses are removed.

A running stack keeps the images it started with, and `websocket_service` is built once per instance. If you change these services, force a rebuild with this flag:

```bash
just run_local --build-aux-services
```

When you start the stack with `--build-aux-services`, press `r` to rebuild those images and recreate their containers. Detached, run `just run_local rebuild --build-aux-services`. This is slower, so leave the flag off unless you work on those services.

If you started without the flag and suspect a stale image, press `q`. Then start again with the flag.

## Lower-Level Stack Control

Use `just run_local`, with or without a terminal. `just stack` is the same bring-up
with no background process, kept for Cursor Cloud and environment bakes, which need
`--infra-only`, or a prebuilt `--binaries-dir` adopted with `update`.

**`just stack up` always deletes the instance's data first.** Use it only when you
mean that.

```bash
just stack up                  # wipe, bring everything up with a static frontend, print URLs, return
just stack status --json      # same as `just run_local status --json`
just stack update             # same rebuild as `just run_local rebuild`, without the background job
just stack update --frontend  # also rebuild the frontend bundle
just stack update --services contacts_service  # rebuild and reload only these; status lists the rest if stale
just stack update --binaries-dir <dir>  # remount a prebuilt set; volumes stay
just stack down               # remove containers, volumes, and state
```

The `run_local` start flags also apply to `stack up`. This includes `--instance`, `--no-doppler`, `--no-build`, and `--binaries-dir`. Every flow records the same state, so `stack update` works on a `run_local` instance. With no recorded stack it bootstraps through `stack up` only if the instance has no volumes; otherwise it refuses, unless you pass `--wipe-if-unrecorded`.

A static frontend (`stack up`, or `run_local --static-frontend`) is built once and served by the proxy at `<proxy>/app/`. The bundle counts as local, as the dev server does: flags, routes and tools gated on `LOCAL_ONLY` are on. It resolves its backend from the origin it is served on, so the same stack works on localhost or behind any hostname without a rebuild.

Both frontends prepare the browser WebAssembly packages through `bun run dev:prepare`, in the background while the services build. A package whose sources match one any worktree on the machine has built is copied from `~/.cache/macro-local/wasm-pkgs` instead of compiled; later starts reuse the generated packages when they are current. The static bundle is cached in `~/.cache/macro-local/frontend-bundles`, keyed by the frontend sources as they are on disk (`apps/web`, `packages`, `static_assets`, the root manifests, uncommitted and untracked files included), the generated wasm packages and every `VITE_*` variable, so a stack whose frontend hasn't changed skips `vite build`. Instances started from one worktree share those packages and `apps/web/dist`, so their frontend builds take turns: a start that has to wait says so. See [Integration Secrets](#integration-secrets) for credential-free startup limitations.

For Pipedream Connect on a machine hostname, include that HTTPS origin in
`PIPEDREAM_ALLOWED_ORIGINS` through `--env-file`; the static-frontend default names
only localhost. `run_local rebuild` reuses the recorded file; pass it again to
`just stack update`.

### Init Snapshots

`just run_local` and `stack up` both cache the expensive infrastructure initialization. The first cold run:

- Migrates the database
- Creates the Kafka topics
- Waits for the FusionAuth kickstart
- Creates the search indices

It saves these volumes as an init snapshot, and clean starts restore it. A detached start over existing volumes keeps them and doesn't use a snapshot. The snapshot is content-addressed and stored in `~/.cache/macro-local/stack-snapshots`, shared by every worktree and instance on the machine (`MACRO_STACK_SNAPSHOT_DIR` overrides it). Later runs restore the snapshot and skip the initialization. The key covers the migrations, compose files, search mappings and the FusionAuth kickstart, but not the instance's ports: each start writes its own redirect URLs into FusionAuth instead. An input change causes a cache miss and a normal full init — the key *is* the definition of clean state, so the full-delete/full-create guarantee is unchanged. Snapshots unused for 14 days are deleted when a new one is saved.

Useful commands:

```bash
just run_local --no-snapshot  # skip the snapshot cache
just stack up --no-snapshot   # same flag
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

Stop an instance, including its background process, but keep its volumes:

```bash
just stop_local --instance agent-a    # same as just run_local stop
```

Remove the containers, volumes, and named-instance networks of an instance:

```bash
just destroy_local --instance agent-a
```

Drop, recreate, and migrate an instance database:

```bash
just reset_local --instance agent-a
```

### Finding out where a bring-up spent its time

Every run prints its slowest stages before the summary. To compare runs, point
`MACRO_LOCAL_TIMINGS` at a file — each run appends one JSON line of every stage
and its duration:

```bash
MACRO_LOCAL_TIMINGS=/tmp/run-local-timings.jsonl just run_local
```

For the default instance, omit `--instance`.

### Timings sent to Grafana (on by default)

`run_local`, `run_dev`, `just stack up`/`update` and `cargo x build-services`
send their timings to Loki and Tempo, as CI does, for the `Macro run_local`
dashboard. This is on by default. To turn it off, either:

```bash
export MACRO_LOCAL_TELEMETRY=off          # this shell, or put it in your profile
```

```toml
# ~/.config/macro/local-telemetry.toml   ($XDG_CONFIG_HOME/macro/ if set)
enabled = false
```

It is also off when `CI` is set (`MACRO_LOCAL_TELEMETRY=on` overrides that).
Opted out, nothing is written or sent.

**What is sent.** Each bring-up, `rebuild`, `restart-frontend`, `stop`, `r`/`f`
hotkey, `stack up`, `stack update` and `build-services` sends one `run` line,
plus a line per step, per service build (cargo units compiled, sccache hits) and
per container's wait for its first passing health probe. Lines carry step and
service names, timings, outcome, the commit, OS/arch and CPU count, and hashed
host, worktree, instance and branch ids (`default` and `main` are sent as they
are); never your name, paths, env values, error text or the token. Fields and queries:
[observability README](../../infra/stacks/observability/README.md#run_local-events-in-loki).

**Credentials.** The settings file holds the endpoint and the bearer token of
the OTLP ingest route, which can send telemetry but not read it. When the file
doesn't exist, the first run writes it (mode 0600) from your own `doppler login`,
reading only `LOCAL_TELEMETRY_TOKEN` from the `observability` project's `lcl`
config. That value is never downloaded with the `local` project's secrets, so it
never reaches a generated env file, a container or a child process's
environment. If Doppler can't provide it (logged out, offline, no access), the run
carries on, records nothing, prints one hint once, and tries again after an hour.
A provisioned token that the endpoint rejects is fetched again once. To edit a
provisioned file, delete its `provisioned = true` line so it is never replaced.

You can also write the file yourself:

```toml
endpoint = "https://otlp.macro-internal.com"
token = "<OTLP ingestion token>"
# traces = false  # only Loki
```

`endpoint` must be `https://`, except for `localhost`, and a file with a token
that others can read (`chmod 600` it) is refused with a one-line warning. A file
you wrote is never replaced.

**Never in your way.** Recording and sending never slow a run down or fail it.
Events are written to `~/.local/state/macro/local-telemetry/` first, and a
background thread fetches the token if needed and sends them every 20 seconds
and when the run is ready; `last-send.json` there shows the last attempt's HTTP
status, and `provision.json` the last token fetch. A run killed before sending,
a `stop`, or a send that failed is sent by your next run, and a killed bring-up
shows up as `outcome="interrupted"` with the step it was in. Unsent events are
dropped after a week.

To try it without the hosted stack, run a throwaway Loki and point the file at
it with `endpoint = "http://127.0.0.1:3100/otlp"` and `traces = false`.

## Local Kubernetes

For the Nix-declared kind runtime, isolated namespaces and two HTTPS slots, see
[local Kubernetes](local-kubernetes.md).
