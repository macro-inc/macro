# macro_auth

## What it is

Belongs to shared infrastructure: low-level JWT and internal-credential
primitives used across services — decoding Macro API tokens, validating the
internal API key, and the Axum JWT-decode middleware.

## Start here

- `src/credential.rs`: `request_credential`, the one reading of which
  credential a request authenticates with and every user token it carries,
  from every source (percent-decoded `macro-api-token` query keys, bearer,
  the access-token cookie decoded as cookie jars read it, user API key,
  bot, harness and internal key headers), kept in the request's
  extensions. A repeated cookie authenticates with the last, as cookie jars
  keep it. `macro_authorization` and `agent_correlation` read it;
  `AccessTokenExtractor` reads `access_token_sources` from the same parse
  (the first bearer, else the last cookie, nothing else), as it always has.
- `src/macro_api_token.rs`: the Macro API token (JWT) shape and claims.
- `src/internal_api_key.rs`: `InternalApiKey`, the shared-secret credential
  for service-to-service calls.
- `src/middleware/decode_jwt.rs`: Axum middleware that decodes and attaches
  the JWT to a request.
- `src/headers.rs`: header name constants used across services.

## Scope

- Owns: token/credential parsing and validation primitives.
- Not here: deciding whether a request is authorized — that's
  `macro_authorization`, which builds on this crate for its JWT validator and
  internal auth adapters.

## Boundaries

- Depends on: `macro_env`, `macro_env_var`, `macro_user_id`, `remote_env_var`.
- Used by: `macro_authorization`, `agent_egress`, `ai_tools`, `decode_jwt`,
  `local_e2e_test_support`, `search_service`.

## Checks

- `cargo test -p macro_auth` (`SQLX_OFFLINE` unset).

Macro API tokens may include a signed `agent_id` for SDK message attribution,
and with it an `agent_via` client label ("Claude Code"), plus a signed
`routine_id` naming the routine whose run the token acts for (loop protection,
see `agent_correlation`). Ordinary user token producers leave them absent; only
key-holders signing for a verified context set them, never from request input.

## Gotchas

- This crate only decodes/validates credentials; it has no concept of
  principals, policies, or 403s — don't add authorization decisions here,
  add them in `macro_authorization`.

## Related

- Rules: `.agents/rules/rust/security.md`

- SDK JWTs optionally carry signed `agent_correlation_id` and managed-MCP `agent_session_id`; these are attribution, never additional authorization.
  A code-mode credential whose session runs in a narrower scope, and a
  routine dry run's credential (`dry_run`), also sign `agent_scope` (the
  scope's stored name), so services with no database can enforce it; it only
  narrows what the credential may do.
