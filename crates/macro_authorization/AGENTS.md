# macro_authorization

## What it is

Belongs to shared infrastructure: transport-independent authorization used
by nearly every authenticated service. Validates user, bot,
internal-service, harness, and user-API-key credentials and returns a typed
principal; the Axum layer (`axum` feature) exposes this as extractors keyed
by policy.

## Start here

- `src/lib.rs`: doc comment has the full extractor/policy table (which
  principals each `AuthorizationPolicy` admits, and its narrowed output type)
  — read this before adding or choosing an extractor.
- `src/domain/service.rs`: `MacroAuthorizationServiceImpl` — the composed
  authorization service; bot and user-API-key authorizers are required
  explicitly (pass `NoBotAuthorizer`/`NoUserApiKeyAuthorizer` to opt out).
- `src/inbound/axum.rs`: the Axum extractors and rejection type.
- `src/outbound/pg_*.rs`: Postgres-backed bot/harness/user-API-key
  authorization repos (feature `postgres`).

## Scope

- Owns: authenticating a caller (user/bot/internal/harness/API-key) into a
  typed principal, and the bot scope (`user`/`team`) header contract.
- Not here: deciding whether that principal may act on a specific entity —
  that's a typed entity-access receipt in the domain layer that calls in.

## Boundaries

- Depends on: `macro_auth` (outbound JWT validation), `bot_id`, `bot_token`,
  `harness_id`, `harness_token`, `model_user`, `model-error-response`.
- Used by: essentially every
  authenticated HTTP surface (`agent_session`, `agent_harness`, `ai_tools`,
  `bots`, `calendar_events`, `channels`, `chat`, `documents`, ...).

## Recipes

- Add a new axum policy: add the `AuthorizationPolicy` impl + its narrowed
  output type in `src/inbound/axum.rs` → document it in the `lib.rs` table →
  re-export both from `lib.rs`.
- Wire a new service with MacroDB: `PgBotAuthorizer` + `PgUserApiKeyAuthorizer`
  (feature `postgres`) in the composition root — see `calendar_service` or
  any service in `services/` for the pattern.

## Checks

- `cargo test -p macro_authorization` (`SQLX_OFFLINE` unset).

`ValidatedIdentity` contains identity facts; `ValidatedCredential` and
`MacroUserAuthentication` additionally carry `CredentialOrigin` (session, Macro API
JWT, user API key, or the acting user of a bot, harness or internal caller), set
where the credential is verified. Every `JwtValidator` implements
`validate_credential` (`validate` derives from it) and every
`MacroAuthorizationService` implements `authorize_identity`; neither has a default
that assumes a session. Session-only fakes use `ValidatedCredential::session`. The
production `MacroAuthJwtValidator` derives origin from the verified token enum in
one decode.
Personal-session-only capabilities match `origin == Session` (and no agent
attribution) instead of sniffing request headers. `authorize_identity` retains
verified origin and signed agent attribution on user authentication. It
does not turn a user credential into bot authority or change endpoint policies.

## Gotchas

- Both extractors reject (400) a request that combines explicit credential
  types (internal key, bot token, user API key, bearer/query user) rather
  than picking one — don't "fix" this by adding precedence logic.
- Cookies are ambient and only considered when no explicit credential is
  present; an explicit credential always wins over a cookie.
- A valid principal not admitted by the chosen policy is a 403, not a 401.
- `mark_harness_token_used` runs on every harness-authenticated request. It
  writes `last_used_at` at most once a minute and skips a row another request
  is already updating. Don't make it a plain per-request `UPDATE`: one busy
  token would then queue its requests on the row lock, each holding a pool
  connection.

## Related

- Rules: `.agents/rules/rust/security.md`, `.agents/rules/rust/architecture.md`
