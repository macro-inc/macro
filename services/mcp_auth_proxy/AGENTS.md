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
- `src/domain/resource.rs`: the RFC 8707 resources the broker signs in for (the
  ChatGPT MCP Worker by its exact URL, the harness's public MCP for anything
  else) and which token each gets; see README "Which MCP server a token is for".
- `src/domain/browser_binding.rs`: the cookie secret tying a flow to the browser
  that started it, and the anti-forgery token the broker's forms carry.
- `templates/`: the broker's pages (sign-in chooser, consent and its cancellation,
  email sign-in, manual delivery), which share `broker_page.css`.
- `src/domain/ports.rs`: `ClientRegistrationStore`, `OAuthProvider`,
  `EmailCodeProvider`, `RefreshTokenBindingStore`, `MacroApiTokenMinter` — the
  ports the service depends on. The harness implements the minter
  (`agent_harness_service/src/public_mcp/macro_api_tokens.rs`).
- `src/inbound/axum_router.rs`: HTTP routes; `src/inbound/middleware.rs`: auth.
- `src/outbound/postgres.rs`: the store of record for all broker state
  (registrations, refresh token bindings, pending authorizations, issued
  codes). Issued codes are stored by digest with their upstream tokens
  KMS-encrypted under `MCP_OAUTH_KMS_KEY_ID`.
- `src/outbound/redis_cutover.rs`: wraps the Postgres store during the move
  off Redis: Postgres first, Redis fallback with copy-forward, registrations
  and bindings mirrored to Redis, plus the startup backfill.
- `src/outbound/email_sign_in.rs`: emailed sign-in codes, through the
  authentication service's public login endpoints.
- `src/outbound/fusionauth.rs`, `src/outbound/redis.rs`: the upstream provider
  and the legacy Redis store (all adapters gated behind the `outbound`
  feature; `inbound`/`outbound` are each optional).

## Scope

- Owns: DCR-compliant client registration, the sign-in chooser and email sign-in
  form, authorization-code issuance (including manual delivery for clients on
  another machine), refresh-token rotation/binding, and RFC 7009 revocation, all
  proxied in front of FusionAuth.
- Not here: the MCP tool surface itself → `services/agent_harness_service/src/public_mcp.rs`;
  the ChatGPT MCP server → `services/mcp-chatgpt-worker`.

## Recipes

- Change redirect URI policy: `src/domain/redirect_uri.rs` → update the README
  section it implements → `services/agent_harness_service/src/public_mcp.rs`
  (`DEFAULT_MCP_ALLOWED_REDIRECT_HOSTS`) if the default allowlist changes.
- Support a new HTTPS MCP client: nothing; users approve it on the consent
  screen. Add its host to `DEFAULT_MCP_ALLOWED_REDIRECT_HOSTS` only to skip that
  screen for a client Macro has vetted.
- Sign clients in for another MCP server: a `McpResource` variant and its URL
  in `McpResources` (from `macro_service_urls`) → the token it gets in
  `access_token_for` (`src/domain/service.rs`) → `public_mcp.rs` wiring → README.
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

- Never refuse an unrecognized `resource`: deployed clients send whatever they
  derive from their configured URL, and refusing it breaks live grants on
  refresh.
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
  field (as `resource` has) needs a hidden input in `templates/consent.html`. The chooser repeats its
  query on its own.
- The manual delivery page puts the callback URL in a shell command. Don't widen
  `RedirectUriPolicy::allows_manual_delivery` past characters that are inert in
  single quotes; see README "Signing in from another machine".
- Pending flows are consumed only by a callback or a redeemed email code. Email
  steps read them with `find_pending`, so a mistyped code doesn't end the sign-in.
- `client_id` is not a secret; every endpoint must still check it against a
  live registration — see README "Which client a grant belongs to" before
  changing token/refresh validation.
- Refresh tokens are bound by SHA-256 digest with rotate-before-drop ordering;
  don't weaken that to avoid a race, and remember pre-binding-era refresh
  tokens have no binding (clients reauthorize once).
- A binding carries the grant id of its token family; rotation must copy it
  and refresh must check the revoked-grant marker, or `/revoke` stops covering
  rotated tokens. Bindings stored as a bare client id are their own family.
- Upstream grants fail with `UpstreamGrantError` (`domain/ports.rs`). Keep a
  grant FusionAuth refused as `InvalidGrant` so `/token` answers
  `400 invalid_grant`; a 5xx tells clients to retry a token that can never
  work. See README "Token endpoint errors".
- Redis is legacy. Write new state to Postgres only; the cutover module's
  Redis mirroring exists solely for replicas on the previous build. Remove it
  only after a deploy that started once no replica ran the Redis-only build
  has logged `backfilled MCP OAuth state from legacy Redis` in each
  environment (an earlier backfill can miss entries those replicas wrote
  late); then wire `PostgresAuthStore` directly and delete `redis.rs` and
  `redis_cutover.rs`.

## Related

- Skill: `new-service` (for how this is wired as a dependency, not a deploy)

- Only verified Macro JWT session provenance becomes `ManagedAgentSession`; external MCP callers remain uncorrelated.
