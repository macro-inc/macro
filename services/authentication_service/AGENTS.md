# authentication_service

## What it is

Account sign-in and identity feature: FusionAuth-backed login, session/JWT
issuance, signup policy and allowlisting, OAuth/OAuth2 account linking
(Google/Microsoft/GitHub), subscription checkout status, Cursor/Codex API
key issuance, and account merge/link flows.

## Start here

- `src/api.rs`: route module list (`login`, `oauth`, `oauth2`, `session`,
  `jwt`, `webhooks`, `signup_policy`, `codex`, `cursor_api_key`, `merge`, ...).
- `src/service/signup_policy/`: `SignupPolicy` built at startup; enforced
  authoritatively by the FusionAuth `user.create` webhook
  (`src/api/webhooks`), not by the public precheck routes.
- `src/config.rs` + `src/doppler_config.rs`: env vars and the Doppler config
  validator binary (`authentication_service_doppler_config`).
- `README.md`: the Develop signup allowlist (bypass flag, rollout/rollback
  steps) and GTM invite links — read before touching signup policy.

## Scope

- Owns: FusionAuth-backed login/session issuance, JWT minting, signup
  allowlisting, OAuth/OAuth2 account linking, GTM invite links, shared-mailbox
  relocation signup, Cursor/Codex API key endpoints, introductory trial
  eligibility and subscription checkout.
- Not here: authorization/permission decisions on other entities →
  `crates/macro_authorization`; metered AI credits → `crates/ai_billing`;
  team lifecycle and seats → `crates/teams`; a person's interface language
  (`/user/language`) → `crates/user_language`.

## Recipes

- Add a route: domain crate (if any) → `src/api/<area>.rs` → `src/api.rs`
  (router) → `src/openapi.rs`.
- Change signup policy: `src/service/signup_policy/` → `src/config.rs` → the
  Develop allowlist rollout steps in `README.md`.
- Add a config value: `src/config.rs` → Doppler project
  `authentication-service` → verify with
  `authentication_service_doppler_config`.

## Checks

- `cargo test -p authentication_service` (`SQLX_OFFLINE` unset).
- Signup-policy changes specifically:
  `env -u DATABASE_URL cargo test -p authentication_service --bin authentication_service config::test`
  and `cargo run -p authentication_service --bin authentication_service_doppler_config`.

## Subscription checkout

- `src/service/subscription_checkout.rs` owns introductory eligibility and
  checkout terms; its Stripe adapter reads every subscription status and page.
- `GET /user/stripe/trial_eligibility` reads the authenticated customer's
  eligibility without creating checkout. Any prior subscription disqualifies
  the first-subscription trial, including canceled or incomplete subscriptions.
  The trial is Pro only. Max checkout is paid immediately, and a trialing Pro
  subscription that moves to Max ends the trial and starts a Max billing cycle
  now. A team's first Max seat does the same; seat changes on a subscription
  already trialing on Max keep its trial.
- Nonterminal subscriptions (including past due, unpaid, paused, and incomplete)
  require management; only canceled and incomplete-expired subscriptions allow
  replacement. Eligibility includes `existingSubscription` for recovery UI.
- Share checkout idempotency generations across Pro, Max, and trial terms. Reuse
  exact open offers; expire other open subscription sessions before replacement.
  Never advance a generation after an ambiguous provider failure. Complete the
  backend rollout before releasing clients that depend on these protections.
- Stripe can cache a create failure under its idempotency key. If no session
  becomes visible, retries deliberately retain that key: rotating it could double
  bill after an ambiguous create. Reconcile using the opaque customer, session,
  and idempotency fields in `billing.checkout` traces and Stripe request logs;
  recover an existing subscription, reuse a confirmed matching checkout, or
  expire a confirmed obsolete open session before retrying. If there is no session to reconcile, escalate to Stripe/support and
  wait for Stripe's key retention to expire (at least 24 hours). Never invent a
  fresh key solely to bypass a failed response.
- Keep eligibility reads and checkout validation on the same policy; the legacy
  `hasTrialed` flag tracks trials only and cannot identify paid-only customers.
- Deploy the eligibility endpoint before web clients that require it; otherwise
  the clients keep Pro checkout disabled until the lookup can succeed.

API-token exchange preserves verified incoming agent attribution; query/body
inputs cannot select an agent, and ordinary user credentials remain unattributed.

## Gotchas

- Fail closed if team cleanup encounters an external chat: external chats require human ownership.

- GitHub reconnect preserves the current link until OAuth completes. A different
  account returns 409; disconnect first to switch accounts. Missing grants report
  reauthentication, while infrastructure failures remain server errors.
  Deploy grant-refresh support before releasing clients that omit the pre-OAuth
  disconnect; older callbacks leave an existing grant unchanged.
- FusionAuth reports a link owner that was deleted as `UserDoesNotExist`. That
  user has no links or grants left, so answer the route's "not linked" outcome
  (404 no grant, 200 for an idempotent removal), not a 500.
- The signup allowlist has a temporary Develop-only bypass
  (`DEVELOPMENT_BYPASS_SIGNUP_ALLOWLIST`) that overrides the allowlist even
  when present; see `README.md` before changing signup behavior.
- Denial responses and policy errors must never disclose configured allowlist
  addresses; never paste operational addresses into code, logs, or docs.
- `/oauth2/{provider}/callback` verifies two signed `state` kinds
  (`src/account_link_state.rs`): account links, which expire, and Microsoft
  admin-consent returns, which do not. A consent screen that ends without a
  code redirects a link flow to its `original_url` with `email_link_error`
  (`admin_consent_required`, `cancelled`, `failed`); only the `AADSTS` code
  from `error_description` is logged, never the description.
- `/oauth/redirect` without a code answers "Sign-in failed" and logs
  `auth_handoff_failure=missing_code` with FusionAuth's error. `invalid_origin`
  ("Invalid origin uri <origin>") means the page that sent the browser to
  FusionAuth is missing from `infra/stacks/fusionauth-instance/origins.ts`;
  these failures carry no user id.

## Related

- Rules: `.agents/rules/config-and-service-urls.md`,
  `.agents/rules/rust/security.md` · Skill: `new-service`
