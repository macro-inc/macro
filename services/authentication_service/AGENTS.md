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
  team lifecycle and seats → `crates/teams`.

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

## Gotchas

- The signup allowlist has a temporary Develop-only bypass
  (`DEVELOPMENT_BYPASS_SIGNUP_ALLOWLIST`) that overrides the allowlist even
  when present; see `README.md` before changing signup behavior.
- Denial responses and policy errors must never disclose configured allowlist
  addresses; never paste operational addresses into code, logs, or docs.

## Related

- Rules: `.agents/rules/config-and-service-urls.md`,
  `.agents/rules/rust/security.md` · Skill: `new-service`
