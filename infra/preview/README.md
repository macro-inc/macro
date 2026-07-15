# Full-stack PR previews on Fly

Label a PR `preview` and CI deploys the **entire stack** — every service,
Postgres, OpenSearch, FusionAuth, LocalStack, the frontend — as one Fly app at
`https://macro-pr-<N>.fly.dev`. The app suspends when idle (≈zero cost) and the
fly-proxy wakes it on the next request. Closing the PR (or removing the label)
destroys it.

## How it works

The preview is not a parallel deployment system: it is the local stack
(`just stack up`, see `RUNNING_LOCALLY.md`) running inside one Fly machine.
A Fly machine is a full microVM, so an inner Docker daemon runs the exact
compose topology `run_local` uses. What differs is that **everything expensive
is baked in CI** and the machine only restores:

| Baked in CI | Restored on the machine |
|---|---|
| Service binaries (`cargo x zigbuild`) | bind-mounted into the runtime image |
| Frontend bundle (`same-origin` build) | served statically by the instance Caddy |
| Init snapshot (migrations + FusionAuth kickstart + search indices) | volumes restored, init skipped |
| Every Docker image, mirrored to the app's Fly registry repo | `docker pull` at boot — layer-dedup'd against the machine's persistent layer store, nothing built |

Boot on a fresh machine ≈ image pulls + snapshot restore + JVM startup
(a couple of minutes); wake from suspend ≈ seconds. Pushes to the PR choose one
of three paths from the durable deployment marker on the Docker volume:

- **bootstrap** — no app/machine yet: create everything and restore the snapshot;
- **hot update** — the snapshot key, staged-runtime hash, and update protocol
  are unchanged: pull a layer-deduplicated artifact carrier, atomically replace
  changed binaries/frontend, and restart only affected containers without
  restarting the Fly machine or infra;
- **rehydrate** — compatibility changed, or a hot update fails: fall back to
  the immutable full-image deploy and snapshot restore.

The URL remains stable across all three paths.

The whole product sits behind the stack's single-origin Caddy proxy
(`:8090`), so one `internal_port` covers the frontend, APIs, WebSockets, and
Mailpit.

## Logging in

Login is passwordless (email codes) and preview email is captured, not sent:
enter any address on the login screen, then open
`https://macro-pr-<N>.fly.dev/mailpit/` to read the code. (Routing login codes
through scoped SES so teammates get real emails is a planned follow-up.)

## Secrets (Doppler)

The stack's local plumbing (DBs, queues, auth identity) is code-owned and
dummy, but integration secrets (AI keys etc.) come from Doppler, exactly like
`run_local`. The workflow stages a **config-scoped service token** onto each
preview app as the Fly secret `DOPPLER_TOKEN`; at boot the env layer detects
the token and pulls that config (no `doppler login` involved), then overlays
the code-owned `LocalEnv` on top — so Doppler supplies integration keys while
local plumbing stays local. A preview machine can only ever read the one
config its token is scoped to.

## One-time setup

1. Create a Fly org deploy token: `fly tokens create org -o <org>` →
   repo secret `FLY_API_TOKEN`.
2. Set the repo variable `FLY_ORG` to the org slug.
3. In Doppler, create a preview config in the `local` project (e.g.
   `lcl_preview` — start from `lcl_personal`, keep only what previews should
   have) and a service token for it → repo secret `DOPPLER_PREVIEW_TOKEN`.
4. Create the `preview` label.

## Security posture

- Previews only build from same-repo branches (the workflow refuses forks).
- No real AWS: S3/SQS/DynamoDB are LocalStack, email is Mailpit. The
  cloud-reachable credentials on a machine are the preview Doppler config's
  contents — scope that config accordingly (assume PR code can read it) — and
  `REGISTRY_PULL_TOKEN`, the CI deploy token attenuated (client-side macaroon
  caveats) to read-only on this one preview app with a 7-day validity window:
  it can pull the app's registry repo, nothing else.
- URLs are public. Anyone with the link can use the preview (and read its
  Mailpit). Don't put sensitive data in one. Edge auth (oauth2-proxy in front
  of Caddy) is a planned hardening step.

## Known costs & future optimizations

- The stack images are mirrored into the per-PR app's registry repo, so the
  first deploy of a PR pushes (and its first boot pulls) the full set; after
  that both sides move only changed layers. There is no cross-PR sharing —
  a shared registry (GHCR/Namespace) would fix that at the cost of new
  org-level credentials.
- The aux images (sync/websocket/lexical) rebuild in CI on every preview
  deploy. Runner-level Docker layer caching covers most of it.
- `cpus = 8, memory = 16gb` (shared) is a deliberate over-provision; measure
  and shrink once a few previews have run.
