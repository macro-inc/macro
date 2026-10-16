# mcp_auth_proxy

## What it is

Supports agent sessions: lets external MCP clients (e.g. cursor.com)
authenticate against Macro. A library crate (mounted into `mcp_service`, not
its own binary) implementing an OAuth 2.1 Dynamic Client Registration broker
in front of FusionAuth, which doesn't support DCR itself.

## Start here

- `README.md`: the security model — which redirect URIs are usable, and which
  client a grant belongs to. Read before touching `/register`, `/authorize`,
  or `/token` logic.
- `src/domain/service.rs` + `src/domain/service/test.rs`: the broker's core
  logic (registration, authorize, token/refresh).
- `src/domain/redirect_uri.rs`: the redirect URI usability policy from the README.
- `src/domain/ports.rs`: `ClientRegistrationStore`, `OAuthProvider`,
  `RefreshTokenBindingStore` — the ports the service depends on.
- `src/inbound/axum_router.rs`: HTTP routes; `src/inbound/middleware.rs`: auth.
- `src/outbound/fusionauth.rs`, `src/outbound/redis.rs`: concrete adapters
  (gated behind the `outbound` feature; `inbound`/`outbound` are each optional).

## Scope

- Owns: DCR-compliant client registration, authorization-code issuance, and
  refresh-token rotation/binding, all proxied in front of FusionAuth.
- Not here: the MCP tool surface itself → `mcp_service`.

## Recipes

- Change redirect URI policy: `src/domain/redirect_uri.rs` → update the README
  section it implements → `services/mcp_service/src/config.rs`
  (`DEFAULT_MCP_ALLOWED_REDIRECT_HOSTS`) if the default allowlist changes.
- Add a new grant type: `src/domain/models.rs` → `src/domain/service.rs` →
  `src/outbound/fusionauth.rs` → `src/inbound/axum_router.rs`.

## Checks

- `cargo test -p mcp_auth_proxy` (`SQLX_OFFLINE` unset).

## Gotchas

- `client_id` is not a secret; every endpoint must still check it against a
  live registration — see README "Which client a grant belongs to" before
  changing token/refresh validation.
- Refresh tokens are bound by SHA-256 digest with rotate-before-drop ordering;
  don't weaken that to avoid a race, and remember pre-binding-era refresh
  tokens have no binding (clients reauthorize once).

## Related

- Skill: `new-service` (for how this is wired as a dependency, not a deploy)
