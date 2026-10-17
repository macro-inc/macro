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

- Depends on: `upstream_error` for outage classification; otherwise a plain
  HTTP client crate.
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
  the body). They turn outages into `Upstream` (502/503 via
  `crates/upstream_error`) and FusionAuth's `[invalid]userId` into
  `UserDoesNotExist`; a hand-written `Generic` becomes a 500.
- Calls to Google or Microsoft name the provider:
  `FusionAuthClientError::provider_transport("Google", e)`.

## Related

- Rules: `.agents/rules/config-and-service-urls.md` (FusionAuth base URL/keys
  are config, not hardcoded)
