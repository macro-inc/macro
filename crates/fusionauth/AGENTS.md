# fusionauth

## What it is

Backs the Authentication feature: a FusionAuth API client for
OAuth/identity-provider login, user management, JWTs, and
passwordless/password flows against the FusionAuth HTTP API.

## Start here

- `src/lib.rs`: `AuthedClient`/unauthenticated client and the crate-wide
  `Result` alias — every module is a thin set of request builders over these.
- `src/identity_provider.rs`: link/login/lookup/search/unlink for third-party
  identity providers (Google, Microsoft, Apple).
- `src/jwt.rs`, `src/oauth.rs`, `src/passwordless.rs`, `src/password.rs`: the
  token and login flows.
- `src/user.rs`: create/delete/get/register/verify.

## Scope

- Owns: typed request/response shapes and calls for FusionAuth's REST API.
- Not here: Macro's own session/cookie handling or route wiring → the calling
  service (`authentication_service`).

## Boundaries

- Depends on: `upstream_error` for outage classification, and
  `macro_service_urls` for Google's OAuth token and revocation endpoints
  (overridable, so a local stack can use `crates/gmail_emulator`); otherwise a
  plain HTTP client crate.
- Used by: `authentication_service`, `mcp_auth_proxy`, `mcp_service`,
  `tooling/seed_cli`, `github` (for linking).

## Recipes

- Add a new FusionAuth endpoint: new `src/<area>.rs` (or a function in an
  existing one) → `pub mod` it in `src/lib.rs` → `wiremock`-backed test next
  to it (see `src/user/test.rs` for the pattern).

## Checks

- `cargo test -p fusionauth`.
- `just check` runs `rules/ast-grep/rust-fusionauth-classify-transport.yml`.

## Gotchas

- Map request failures with `.map_err(FusionAuthClientError::transport)` and
  statuses the endpoint does not document with
  `FusionAuthClientError::unexpected_response` (or `unexpected` after reading
  the body). They turn outages, throttling, timeouts, and undecodable bodies
  into `Upstream` (502/503 via `crates/upstream_error`); a hand-written
  `Generic` becomes a 500.
- `#[tracing::instrument]` records every argument it does not skip as a span
  field, and span fields reach the logs. Skip codes, tokens, and other
  credentials by name.
- The OAuth2 token endpoint (`src/oauth.rs`) turns an RFC 6749 error body on
  400/401 into `OAuth2TokenRefused`; callers check `is_invalid_grant()` to tell
  a dead code or refresh token from an outage. A dead refresh token is
  `invalid_grant`, but a dead code is `invalid_request` with the reason
  `auth_code_not_found`.
- `DELETE /api/jwt/refresh` takes its token as a JSON body; a form body is
  refused with `[InvalidContentType]`.
- Calls to Google or Microsoft name the provider:
  `FusionAuthClientError::provider_transport("Google", e)`.
- Link lookup and unlink map HTTP 400 `userId` / `[invalid]userId` errors to
  `UserDoesNotExist`; other validation, authentication, and server failures
  must remain errors. Never log identity-provider link tokens.
- Bound identity-provider link lookup, creation, and deletion requests to thirty
  seconds, including response-body reads; their callers may hold account locks.

## Related

- Rules: `.agents/rules/config-and-service-urls.md` (FusionAuth base URL/keys
  are config, not hardcoded)
