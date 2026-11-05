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
  allowlisting, OAuth/OAuth2 account linking, GTM invite links, the platform
  status banner API (`crates/system_status`), shared-mailbox
  relocation signup, Cursor/Codex API key endpoints, introductory trial
  eligibility and subscription checkout, and the `/team_agents` routes
  (`crates/team_agents` and `crates/agent_secrets`; optional
  `DEAD_SIMPLE_MAIL_API_KEY`). The agents adapter shares the hosted
  `ComputerService` used for computer billing, passing the seat as an extra
  purchase item so both charges use one subscription update.
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

## Macro computers billing

- `src/outbound/computer_billing.rs`: `TeamComputerBilling`, the
  `hosted_runtimes` `Billing` port on the team subscription (one item per
  `STRIPE_COMPUTER_{STANDARD,LARGE,XL}_{MONTHLY,YEARLY}_PRICE_ID`, chosen by the
  subscription's interval). Prices are `ComputerPrices`
  (`src/domain/computer_billing.rs`), not seat plans. Replay durable item-change
  receipts before resolving current prices or subscription terms.
- Every team subscription webhook re-reads the subscription and reports each
  size's billed count to `ComputerBillingObserver` (`ComputerService`), which
  cancels computers whose items were removed outside Macro. Its failures are
  logged, never fail the webhook. With no computer price configured it does
  nothing; changing a configured price id strands items on the old price.

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

## Agent accounts

- An agent can do everything a person can, including inviting other agents. Do
  not gate actions on `isAgent`; it only changes signup and labeling.
- `User."isAgent"` is set in the FusionAuth `user.create` webhook, from
  `is_agent` on `/login/passwordless` (carried as FusionAuth user data) or a
  pending agent `team_invite`. Those agents skip the seeded content, Loops, and
  Meta. The webhook cannot see SSO state, so `is_agent` on `/login/sso` flags a
  new account in `/oauth/redirect` (`mark_agent`), after that content has started.
- The account exists before its email is verified, so an email signup's flag is
  provisional: a code request or SSO sign-in without `is_agent` reverts it
  (`revert_unconfirmed_agent`) until a key exists, setup is confirmed, or an
  agent invite is pending.
- `POST /user/agent_setup` joins the inviting team and replaces the
  `Agent signup` API key. It is repeatable until `tutorialComplete` is true.
- `POST /user/profile_picture/file` reserves an SFS upload for API-key callers,
  since `static_file_service` cannot check keys. `PUT` on that path takes the SFS
  id and accepts only the caller's PNG, JPEG, WebP, or GIF; it does not wait for
  the asynchronous upload event.

## Gotchas

- `/mobile-welcome-email` copies allowlisted ad parameters from the capture
  request onto the desktop signup link and always sets
  `signup_flow=mobile_email`. The web app keeps that set on the PostHog person
  when the account is identified. Do not take `signup_flow` from the request.
- Answer third-party failures as 502/503, not 500: match
  `GithubError::Upstream(error)` before a route's 500 catch-all, and answer a
  `FusionAuthClientError` whose `upstream()` is set with that error's
  `into_response()`. Document 502/503 with `UpstreamErrorResponse` in the
  route's `utoipa::path`.
- Fail closed if team cleanup encounters an external chat: external chats require human ownership.

- GitHub reconnect preserves the current link until OAuth completes. A different
  account returns 409; disconnect first to switch accounts. Missing grants report
  reauthentication; GitHub or FusionAuth outages answer 502/503, and other
  failures remain server errors.
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
- New Outlook connections need the deployment switch
  `OUTLOOK_CONNECTIONS_ENABLED` and the user's PostHog flag `enable-outlook`
  (`src/domain/microsoft.rs`), read with `crates/feature_flags` for the Macro
  user id the web app identifies with. `/link/email/providers` answers
  `outlook: false` and `/link/outlook` answers 404 for a new connection when
  either is off; reconnecting an inbox reads neither. A failed flag load
  closes new connections and logs one warning. Without `POSTHOG_API_KEY`
  (local, tests) the switch alone decides. Each decision is the
  `outlook.flag` span field (`on`, `off`, `error`, `unconfigured`).
- `/oauth2/{provider}/callback` verifies two signed `state` kinds
  (`src/account_link_state.rs`): account links, which expire, and Microsoft
  admin-consent returns, which do not. A consent screen that ends without a
  code redirects a link flow to its `original_url` with `email_link_error`
  (`admin_consent_required`, `cancelled`, `failed`); only the `AADSTS` code
  from `error_description` is logged, never the description.
- A Google consent that asked for the mailbox but came back without
  `gmail.modify` (the user left the Gmail boxes unchecked) is refused in the
  Google callback before any identity-provider link is written or replaced:
  the pending row is deleted, the partial grant is revoked at Google so the
  next consent screen lists every scope again, and the flow returns with
  `email_link_error=gmail_not_granted`. Google's revocation drops the account's
  whole grant to Macro, so it is skipped when an inbox for that address still
  works (`needs_reauth` false); the refusal stands either way. Mirrors
  Outlook's required-scope check in `src/domain/microsoft.rs`; Macro has no
  mailbox-less link for either provider.
- `/oauth/redirect` without a code answers "Sign-in failed" and logs
  `auth_handoff_failure=missing_code` with FusionAuth's error. `invalid_origin`
  ("Invalid origin uri <origin>") means the page that sent the browser to
  FusionAuth is missing from `infra/stacks/fusionauth-instance/origins.ts`;
  these failures carry no user id.
- When the FusionAuth JWT populate lambda fails (its `fetch` to
  `/webhooks/user/jwt` times out after 2 s or gets a non-200), FusionAuth still
  issues the access token, just without the Macro claims. `/jwt/refresh`
  refreshes such tokens instead of rejecting them, and warns when FusionAuth
  returns one. It answers 429 for one issued under 30 s ago, so client retries
  (websocket reconnects refresh on every attempt) can't turn a lambda outage
  into a FusionAuth refresh per retry.

## Related

- Rules: `.agents/rules/config-and-service-urls.md`,
  `.agents/rules/rust/security.md` · Skill: `new-service`

- Team agent retry is admin-only and reuses the original computer and persona.
  Its adapter receives the same computer repository for scoped bootstrap reads
  and the harness domain repository for enrolled-persona health and last-turn
  time. Repo recovery uses the internal git `ensure` API without token rotation.
