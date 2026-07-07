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
| Every Docker image (`docker save` preload tar) | `docker load` — nothing pulled or built |

Boot on a fresh machine ≈ image load + snapshot restore + JVM startup
(a couple of minutes); wake from suspend ≈ seconds. Pushes to the PR redeploy
the app (a new machine, same URL).

The whole product sits behind the stack's single-origin Caddy proxy
(`:8090`), so one `internal_port` covers the frontend, APIs, WebSockets, and
Mailpit.

## Logging in

Login is passwordless (email codes) and preview email is captured, not sent:
enter any address on the login screen, then open
`https://macro-pr-<N>.fly.dev/mailpit/` to read the code. (Routing login codes
through scoped SES so teammates get real emails is a planned follow-up.)

## One-time setup

1. Create a Fly org deploy token: `fly tokens create org -o <org>` →
   repo secret `FLY_API_TOKEN`.
2. Set the repo variable `FLY_ORG` to the org slug.
3. Create the `preview` label.

## Security posture

- Previews only build from same-repo branches (the workflow refuses forks).
- The stack runs entirely on local-only dummy secrets (`--no-doppler`, the
  code-owned `LocalEnv`) — no Doppler, no real AWS. The only data in a preview
  is what someone puts there.
- URLs are public. Anyone with the link can use the preview (and read its
  Mailpit). Don't put sensitive data in one. Edge auth (oauth2-proxy in front
  of Caddy) is a planned hardening step.

## Known costs & future optimizations

- The VM image is large (several GB — it embeds the preload tar), so deploys
  push more bytes than a typical app. If it hurts: swap the preload tar for a
  Fly volume that caches `/var/lib/docker` across deploys, or pull public
  images at boot.
- The aux images (sync/websocket/lexical) rebuild in CI on every preview
  deploy. Runner-level Docker layer caching covers most of it.
- `cpus = 8, memory = 16gb` (shared) is a deliberate over-provision; measure
  and shrink once a few previews have run.
