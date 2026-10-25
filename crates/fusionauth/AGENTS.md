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

- Depends on: nothing Macro-specific beyond `workspace-hack`; this is a plain
  HTTP client crate.
- Used by: `authentication_service`, `mcp_auth_proxy`, `mcp_service`,
  `tooling/seed_cli`, `github` (for linking).

## Recipes

- Add a new FusionAuth endpoint: new `src/<area>.rs` (or a function in an
  existing one) → `pub mod` it in `src/lib.rs` → `wiremock`-backed test next
  to it (see `src/user/test.rs` for the pattern).

## Checks

- `cargo test -p fusionauth`.

## Gotchas

- Link lookup and unlink map HTTP 400 `userId` / `[invalid]userId` errors to
  `UserDoesNotExist`; other validation, authentication, and server failures
  must remain errors. Never log identity-provider link tokens.
- Bound identity-provider link lookup, creation, and deletion requests to thirty
  seconds, including response-body reads; their callers may hold account locks.

## Related

- Rules: `.agents/rules/config-and-service-urls.md` (FusionAuth base URL/keys
  are config, not hardcoded)
