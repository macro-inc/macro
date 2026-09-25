# Agent previews

`preview_gateway` shares a development server from a coding agent using stock
OpenSSH. Cursor receives the internal `macro-preview` MCP server through its
existing egress connection. External ACP runtimes (including macrod) receive a
session-scoped MCP endpoint during attachment, using the existing egress credential. An agent calls
`SharePreview({"port":3000})`, executes the returned shell script within two
minutes, and continues editing. HTTP and WebSocket traffic use the same SSH
connection, so HMR works without rebuilding or publishing the app.

The script uses a single-use token as the SSH username, `auth_none`, and a pinned
ed25519 server host key. It does not generate or install a client key or disable
host verification, and installs no helper — except on a local stack's quick-tunnel
endpoint, which needs `cloudflared` as a `ProxyCommand` (see below). The remote forward is a logical
`127.0.0.1:1` registration; the gateway opens `forwarded-tcpip` channels directly.
There is no public TCP listener or allocated port per preview, shell access, or
arbitrary direct forwarding.

## Browser access

Each lease has a random `https://<id>.<preview-domain>/` origin. The ID routes
requests; knowing it does not grant access. Anyone with View access to the agent
session can click **View preview**. The control API uses standard Macro
authentication and entity access receipts to issue a 30-second, one-use ticket.
The browser POSTs it to `/.macro-preview/auth` in a new tab, receives a host-only
Secure HttpOnly cookie, and redirects to `/`. App paths and query strings stay
unchanged. Stop requires Edit access; the UI currently exposes it to the owner.

Entity access is checked again when the ticket is redeemed, on every request,
and every 30 seconds during open HTTP streams and WebSockets. Stop and SSH
disconnection cancel open traffic immediately. Session deletion is checked by
the sweeper every 15 seconds. An idle ACP transport disconnect does not terminate
an otherwise live preview. MCP calls use the existing session credential and its normal lifecycle; external
runtime attachment rotates it. It is never replaced with an owner API token.

New Cursor agents receive this MCP server at creation. Existing Cursor agents
keep their original tool configuration and need a new session. Codex CLI and
Claude CLI can use it through an ACP runtime such as macrod. Hosted Codex Cloud
currently rejects MCP servers in its provider adapter and is not supported.
Claude Cloud receives MCP tools but restricted environments must separately
permit outbound SSH to the configured preview host; that provider networking
path is not verified by this change.

The preview domain **must be separate from macro.com** because Macro's browser
cookies cover its subdomains. The gateway rejects Macro's domain, validates
handoff origins, checks application request origins, strips its credential from
upstream requests, and strips Domain attributes from app cookies. It rewrites
Host and same-origin Origin to `localhost:<port>`, while supplying the original
host and HTTPS scheme in forwarded headers. It does not change HTML or inject
framework-specific code. Apps that hardcode browser-facing localhost URLs must
configure their public origin or use relative URLs. Only HTTP backends are
supported; TLS terminates at the public load balancer.

The gateway sends `agent_session_preview` invalidations through the existing
connection gateway. The session banner also fetches state on mount, reconnect,
and every 30 seconds, so missed events and gateway restarts recover automatically.

## Limits

- One preview per session, five active previews per owner, one creation per owner
  every ten seconds; 1,000 retained leases/accounts per gateway.
- One-hour leases; 15 minutes without a browser HTTP request expires a lease.
  WebSocket pings alone do not keep it alive.
- Traffic itself is unmetered. Request-rate, byte-pacing and total-byte ceilings
  were all tried and all severed live previews: a dev server's cold load is
  thousands of modules and tens of MB, and a per-owner byte total that outlived
  lease replacement accumulated across reloads until every stream was cut.
  Expiry, idle timeout and one-preview-per-session are the controls that bound
  cost.
- Per preview: 512 concurrent HTTP streams and eight WebSockets; 16 MiB request
  bodies, 30-second upstream response-header timeout. Traffic is streamed.
- 1,024 SSH connections, bounded SSH authentication time, 128 concurrent control
  requests, 64 KiB control bodies, 15-second control timeout. Tickets and browser
  credentials also have bounded registries and expiry.

These are basic abuse/cost controls, not a hard cloud-spend ceiling. Load
balancer traffic is still billable before application admission, and nothing
here bounds bytes. Gateway restart closes previews and clears all credentials;
agents must share again.

## Deployment

The `infra/stacks/preview-gateway` Pulumi stack creates wildcard DNS and an ACM
certificate, a public HTTPS ALB, a public SSH NLB, and a Fargate task. Macro's
existing gateway routes `/preview/*` to its separate control listener. The task
runs **one replica**, with non-overlapping replacements and no autoscaling:
SSH, HTTP, and control requests must reach the same in-memory registry. Scaling
requires explicit ownership/routing across gateways first.

Before first deployment:

The service has a `bootstrap_pending` reason in `.github/services-config.json`
until these prerequisites are ready. CI still builds, lints, and tests its Rust
and TypeScript, but explicitly defers live Doppler validation and Pulumi preview;
automatic deployment excludes it and the manual service deployment workflow
rejects it. Direct Pulumi commands remain available for bootstrap. Other services'
checks remain strict, including failures caused by missing configuration.

1. Initialize `macro-inc/preview-gateway/dev` and `macro-inc/preview-gateway/prod`
   Pulumi stacks. Choose a separate preview domain and its Route 53 zone. Set Pulumi
   `preview_domain` and `preview_zone_id` for the dev or prod stack. Dev and prod
   should use distinct DNS suffixes.
2. Deploy the Doppler projects stack to create `preview-gateway` and its secret
   sync. In its `dev` / `prd` config, set `DATABASE_URL` and `INTERNAL_API_KEY`
   using the existing service secret references. Generate a persistent ed25519
   key with `ssh-keygen -t ed25519 -N '' -f <private-temporary-path>` and store
   its private PEM as `PREVIEW_SSH_HOST_KEY` in Doppler. Do not commit the key.
3. The preview stack manages `PORT`, `ENVIRONMENT`, `PREVIEW_DOMAIN`,
   `PREVIEW_SSH_HOST`, `PREVIEW_APP_ORIGIN`, and `PREVIEW_CONTROL_HOSTS` in Doppler.
   They must be present in the synced `APP_SECRETS_JSON` before a task can become
   healthy. MacroConfig does not merge missing JSON keys from ECS environment
   variables. Run `preview_gateway_doppler_config` to validate service config.
4. Remove `bootstrap_pending` from the service inventory and open a PR. This
   inventory-only change triggers live Doppler validation and Pulumi previews
   before enabling the normal deployment pipeline; do not remove it before dev
   and prod configuration are ready. Deploy gateway, harness, and web changes.
   Confirm `/preview/health`, call SharePreview,
   execute the script, and verify a page edit over HMR and Stop sharing.

A domain, DNS zone, and production secrets are deployment prerequisites, not
embedded defaults. Rotating the host key invalidates previously issued scripts;
new tool calls pin the new public key.

## Local stack and verification

`just stack` includes the gateway in the local service inventory and cached Nix
binaries. It generates a persistent key in the instance artifact directory and
publishes control port 8110, SSH port 2222, and preview HTTPS port 8443 (named
instances derive their own ports). Caddy serves `*.preview.localhost` using its
internal CA; trust that instance's Caddy CA for browser use. Its data is stored in
`preview-caddy-data` beside the generated Caddyfile. The root certificate is
`preview-caddy-data/caddy/pki/authorities/local/root.crt`; import it into the
host/browser trust store (container trust does not configure the host). The generated script tries
host loopback first, then the pinned Docker `preview-gateway:2222` endpoint, and
— with `--with-cf-tunnel` — a Cloudflare quick tunnel last.
External host runtimes receive `EXTERNAL_EGRESS_BASE_URL` (the instance's
localhost egress port, or its public egress tunnel when enabled); Docker agents
keep their Docker-network endpoint and the same session credential.
An agent that runs neither on this machine nor in the compose network — a
`@cursor` session on cursor.com — can reach neither of those endpoints. Running
`just run_local --with-cf-tunnel` publishes a third one: a quick tunnel whose
origin is `tcp://localhost:<preview ssh port>`, minted per run and written to
`PREVIEW_SSH_PROXY_HOST`. Cloudflare's edge proxies HTTP ports only, so the
script reaches it through `cloudflared access ssh --hostname <host>` as an
OpenSSH `ProxyCommand`, fetching `cloudflared` first when the agent's image
lacks it. That is the one endpoint that is not pure stock OpenSSH; it still
installs no client key, and the pinned host key, one-use token and every quota
apply unchanged. The hostname itself grants nothing: it only reaches the SSH
listener, which accepts a single unexpired token.

Without the flag, `PREVIEW_SSH_PROXY_HOST` is empty and previews stay reachable
from this machine and the compose network only. A deployed gateway rejects the
setting outright — it is dialled directly, and must never depend on someone's
laptop tunnel.

For the repo frontend, `.cursor/frontend.sh` routes API and WebSocket calls
through the same Vite origin, and Vite derives its HMR address from the browser.
The tunnel itself remains framework-independent.

Run from the repository root, leaving `SQLX_OFFLINE` unset:

```sh
cargo test -p agent_preview
cargo test -p preview_gateway
cargo test -p agent_egress
cargo test -p agent_harness
cargo test -p xtask_local
```

The preview tests use a real OpenSSH client against the russh server, exercise
HTTP and WebSocket forwarding and cancellation, and test ticket replay, host
binding, permission revocation, origin checks, and shared quotas.
