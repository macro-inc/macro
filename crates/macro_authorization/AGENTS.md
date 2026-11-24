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
JWT, scoped Macro API JWT, user API key, or the acting user of a bot, harness or
internal caller), set where the credential is verified. Every `JwtValidator` implements
`validate_credential` (`validate` derives from it) and every
`MacroAuthorizationService` implements `authorize_identity`; neither has a default
that assumes a session. Session-only fakes use `ValidatedCredential::session`. The
production `MacroAuthJwtValidator` derives origin from the verified token enum in
one decode.
Personal-session-only capabilities match `origin == Session` (and no agent
attribution) instead of sniffing request headers. A Macro API token's signed
`agent_id` and `routine_id` reach `MacroUserAuthentication`;
`attribution()` reads them as `CredentialAttribution`. Routes where only a
person may decide, answer or approve (review decisions, elicitation and
permission answers, held tool-call approvals, the email sign-in, call tokens, Google and GitHub
link starts) refuse anything but `Person` through `is_program_run(attribution, headers)`;
sign-in routes answer with `PROGRAM_SIGN_IN_REFUSAL`. Routes that only ask a
program to confirm (email send and schedule, calendar create) use `is_agent_run`,
which leaves owner routine steps (`Routine`) alone so scheduled sends keep
working, even with `x-macro-code-execution`: the runtime marks every code
step's request, so the header counts only for a credential that signs no
program (`Person`), never against a signed claim. A routine step running as
its owner signs only `routine_id`, so never test `agent_id` alone for "is
this a person". `authorize_identity` retains
verified origin and signed agent attribution on user authentication. It
does not turn a user credential into bot authority or change endpoint policies.

An account manager's credential arrives as a normal `x-macro-user-api-key` and
authenticates as the managed account, with `CredentialOrigin::AccountManager`
naming the grant and the agent holding it. `AccountHolderOrInternal` is
`UserOrInternal` minus that credential and `ScopedMacroApiJwt` (a Macro API token
that signs `agent_scope`, held by a scoped code-mode run or a routine dry run):
use it on anything that mints credentials, changes who can sign in, deletes
the account, or changes its managers.

## Gotchas

- `rewrite_program_json` rewrites a JSON response only for a program's request (`request_is_program`: the header, or the request's own user token, from `request_credential`, signed for an agent or routine run). Layer it inside compression, so it reads the handler's JSON.
- Both extractors read the request's credential only through
  `macro_auth::credential::request_credential`, the same reading the agent
  scope check (`agent_correlation`) uses, so the two can't disagree. A user
  token authenticates by fixed precedence: `macro-api-token` query parameter
  (keys percent-decoded), then bearer, then the access-token cookie.
  Explicit credentials of different kinds (internal key, bot token, harness
  token, user API key, explicit user token), or one credential header with
  different values, are refused 400 `conflicting_credentials`; an ambient
  cookie beside another credential is not a conflict (browsers and native
  apps send it everywhere), and the scope check still reads its token.
- Locally (`local_auth`), a configured user stands in for an ambient cookie
  or none; an explicit user token is always the one used.
- A valid principal not admitted by the chosen policy is a 403, not a 401.
- Every user credential the Axum layer verifies (`authenticated_user`) sets
  `auth.credential` (the `CredentialOrigin` kind) and `auth.principal_id`
  (SHA-256 of the user id, as `agent_credentials::telemetry_id`) on the
  current span, the request's. That is the service's own finding; a
  caller's `traceparent` only says which trace the caller claims. Never
  record the user id itself: an agent's carries an email.
- A route whose response carries a new credential's secret refuses
  `is_program_run`, because a program's results reach the model: the
  bot-token, channel-scoped bot and user API key routes do. The header alone
  does not hold there; a program can drop it with a raw `fetch`.
- `mark_harness_token_used` runs on every harness-authenticated request. It
  writes `last_used_at` at most once a minute and skips a row another request
  is already updating. Don't make it a plain per-request `UPDATE`: one busy
  token would then queue its requests on the row lock, each holding a pool
  connection.

## Related

- Rules: `.agents/rules/rust/security.md`, `.agents/rules/rust/architecture.md`
