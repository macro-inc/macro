# mcp_auth_proxy

## What it is

Supports agent sessions: lets external MCP clients (e.g. cursor.com)
authenticate against Macro. A library crate (mounted into `agent_harness_service`, not
its own binary) implementing an OAuth 2.1 Dynamic Client Registration broker
in front of FusionAuth, which doesn't support DCR itself.

## Start here

- `README.md`: the security model — which redirect URIs are usable, and which
  client a grant belongs to. Read before touching `/register`, `/authorize`,
  or `/token` logic, and its "Disconnecting a client" section before touching
  `/revoke`.
- `src/domain/service.rs` + `src/domain/service/test.rs`: the broker's core
  logic (registration, authorize, token/refresh).
- `src/domain/redirect_uri.rs`: the redirect URI policy from the README: trusted,
  needs consent, or refused.
- `src/domain/client_kind.rs`: which known product (Claude, ChatGPT, ...) a
  registration is, for the mark its posts wear; README "Which product a client
  is".
- `src/domain/browser_binding.rs`: the cookie secret tying a flow to the browser
  that started it, and the consent form's anti-forgery token.
- `templates/`: the consent screen and its cancellation page.
- `src/domain/ports.rs`: `ClientRegistrationStore`, `OAuthProvider`,
  `RefreshTokenBindingStore` — the ports the service depends on.
- `src/inbound/axum_router.rs`: HTTP routes; `src/inbound/middleware.rs`: auth.
- `src/outbound/postgres.rs`: the store of record for all broker state
  (registrations, refresh token bindings, pending authorizations, issued
  codes). Issued codes are stored by digest with their upstream tokens
  KMS-encrypted under `MCP_OAUTH_KMS_KEY_ID`.
- `src/outbound/redis_cutover.rs`: wraps the Postgres store during the move
  off Redis: Postgres first, Redis fallback with copy-forward, registrations
  and bindings mirrored to Redis, plus the startup backfill.
- `src/outbound/fusionauth.rs`, `src/outbound/redis.rs`: the upstream provider
  and the legacy Redis store (all adapters gated behind the `outbound`
  feature; `inbound`/`outbound` are each optional).

## Scope

- Owns: DCR-compliant client registration, authorization-code issuance,
  refresh-token rotation/binding, and RFC 7009 revocation, all proxied in
  front of FusionAuth.
- Not here: the MCP tool surface itself → `services/agent_harness_service/src/public_mcp.rs`.

## Recipes

- Change redirect URI policy: `src/domain/redirect_uri.rs` → update the README
  section it implements → `services/agent_harness_service/src/public_mcp.rs`
  (`DEFAULT_MCP_ALLOWED_REDIRECT_HOSTS`) if the default allowlist changes.
- Support a new HTTPS MCP client: nothing; users approve it on the consent
  screen. Add its host to `DEFAULT_MCP_ALLOWED_REDIRECT_HOSTS` only to skip that
  screen for a client Macro has vetted.
- Recognize a new MCP client product: a variant in `crates/mcp_client_label` →
  its name and redirect evidence in `src/domain/client_kind.rs` → its mark in
  `apps/web/src/lib/core/component/mcpClientMark.ts`.
- Add a new grant type: `src/domain/models.rs` → `src/domain/service.rs` →
  `src/outbound/fusionauth.rs` → `src/inbound/axum_router.rs`.

## Checks

- `cargo test -p mcp_auth_proxy --all-features` (`SQLX_OFFLINE` unset; the
  Postgres adapter tests need a migrated local MacroDB).

## Shared listener

Use `mounted_mcp_router` in the harness so MCP does not override process
readiness at `/health`. The standalone `mcp_router` remains available to tests
and other library consumers. Both retain OAuth metadata, CORS, and bearer auth.

## Gotchas

- Don't add an MCP client's host to FusionAuth's authorized origins
  (`infra/stacks/fusionauth-instance/origins.ts`). `/authorize` withholds the
  client's Referer from FusionAuth, so a new client needs no origin entry.
  See README "Origin versus redirect URI".
- Every `/authorize` response except the sign-in chooser sets the
  `__Host-macro_mcp_oauth` cookie and `/oauth/callback` requires it. Don't drop
  the check for trusted clients or relax the cookie to `SameSite=None`; see
  README "Consent and browser binding".
  The consent page's CSP has no `form-action`: browsers apply it to the
  form's redirect to FusionAuth.
- The consent form re-posts the authorize request, so a new `AuthorizeRequest`
  field needs a hidden input in `templates/consent.html`.
- `client_id` is not a secret; every endpoint must still check it against a
  live registration — see README "Which client a grant belongs to" before
  changing token/refresh validation.
- Refresh tokens are bound by SHA-256 digest with rotate-before-drop ordering;
  don't weaken that to avoid a race, and remember pre-binding-era refresh
  tokens have no binding (clients reauthorize once).
- A binding carries the grant id of its token family; rotation must copy it
  and refresh must check the revoked-grant marker, or `/revoke` stops covering
  rotated tokens. Bindings stored as a bare client id are their own family.
- Redis is legacy. Write new state to Postgres only; the cutover module's
  Redis mirroring exists solely for replicas on the previous build. Remove it
  only after a deploy that started once no replica ran the Redis-only build
  has logged `backfilled MCP OAuth state from legacy Redis` in each
  environment (an earlier backfill can miss entries those replicas wrote
  late); then wire `PostgresAuthStore` directly and delete `redis.rs` and
  `redis_cutover.rs`.

## Related

- Skill: `new-service` (for how this is wired as a dependency, not a deploy)
