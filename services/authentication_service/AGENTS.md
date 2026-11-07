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
  (`crates/team_agents`; optional
  `DEAD_SIMPLE_MAIL_API_KEY`). The agents adapter shares the hosted
  `ComputerService` used for computer billing, passing the seat as an extra
  purchase item so both charges use one subscription update. The admin-only
  `/team_agents/sizes` catalog does not require a subscription; quote conflicts
  expose `code: "no_subscription"` for the invitation billing prompt.
  Every team-agent admin operation (including roster, catalog and voice settings)
  shares one fail-closed `enable-team-agents` snapshot per authenticated actor.
  Teammates discover their own team’s agent computer through the member-authorized
  `/team_agents/{agent_user_id}/computer` route. Agent self-service and runtime
  credentials remain independent of the rollout.
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

## Computer billing identifiers

- Treat the six `STRIPE_COMPUTER_*_PRICE_ID` values as an optional all-or-none group: none means computers are not sold here; any partial group fails startup and Doppler validation even without `COMPUTERS_FLEET`. An enabled fleet requires all six. Validate configured price syntax in both startup and the Doppler binary.
- Store computer interval prices as `Option<stripe_price_id::StripePriceId>` and reject malformed configured IDs during configuration loading, including when the fleet is disabled. `Config::computer_prices` returns a validation result.

## Checks

- `cargo test -p authentication_service` (`SQLX_OFFLINE` unset).
- Signup-policy changes specifically:
  `env -u DATABASE_URL cargo test -p authentication_service --bin authentication_service config::test`
  and `cargo run -p authentication_service --bin authentication_service_doppler_config`.

`TEAM_AGENTS_INCLUDED_EMAIL_DOMAIN` is required configuration; set `macro.com`
for deployed environments, or empty to disable. Local instances must explicitly
opt into a staff domain in their env file; the boot placeholder is empty. A
verified current primary email of an owner or administrator at that exact domain
qualifies the team. `MacroStaffCompPolicy` shares the team-agents domain check
with the computer service. Comped agents have no seat item, use
`PurchaseBilling::Comped`, and release without Stripe calls. This does not change
metered AI usage policy.

## Macro computers billing

Team computer purchase, quote and offers use the shared fail-closed
`enable-macro-computers` rollout via `ComputerService::with_rollout`; compose
it from the existing PostHog provider. Existing management, internal APIs,
webhook reconciliation and billing workers remain ungated.

- `src/outbound/computer_billing.rs`: `TeamComputerBilling`, the
  `hosted_runtimes` `Billing` port on the team subscription (one item per
  `STRIPE_COMPUTER_{STANDARD,LARGE,XL}_{MONTHLY,YEARLY}_PRICE_ID`, chosen by the
  subscription's interval). Prices are `ComputerPrices`
  (`src/domain/computer_billing.rs`), not seat plans. Replay durable item-change
  receipts before applying changes. Purchase snapshots the quoted price id;
  retries and removal use that saved id rather than resolving current prices.
- With no computer prices, quote and purchase return 503 `computers are not available in this environment` through the shared computer router, before contacting Stripe.
- Every team subscription webhook re-reads the complete subscription and reports
  item quantities by price id to `ComputerBillingObserver` (`ComputerService`).
  Reconcile against each row's saved price id, including prices no longer in
  configuration; cancel newest excess computers per price. Ignore partial
  subscription snapshots. Observer failures are logged, never fail the webhook.

## Subscription billing status

`GET /user/stripe/subscription_status` includes nullable `billing` details for
personal subscribers and team owners/admins. Allocation and access policy live in
`service/subscription_status/billing_facts.rs`; the Stripe adapter supplies actual
recurring prices, quantities, upcoming invoice amounts and owning-domain facts.
Computer billing facts retain canonical `ComputerId` and `ComputerName` until
the response renderer emits their UUID and string wire values.
Match provider items to recorded computer IDs or price IDs and label them from
the stored catalog entry and resources. Never infer an existing computer size
from the current price table; unlinked legacy charges remain generic Computer rows.
Included memberships contribute no paid seat amount. Comped computers appear as
zero rows, and unmatched or ambiguous provider quantities remain `other` rather
than invented per-account charges. Unsupported interval/price shapes have no
breakdown. Amounts preserve Stripe wire currency units, including its currency
exceptions; clients must use provider currency scaling. The recurring subtotal
excludes invoice adjustments; `nextInvoice.amount` is the actual provider amount
due and its date is absent when the provider supplies no payment/due date.

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
  not gate actions on `isAgent`; it only changes signup and labeling. The one
  exception: only an agent can be an account manager, and an agent can't be
  managed (`crates/account_manager`).
- Routes that mint credentials, link a sign-in, merge accounts, or delete the
  account use `AccountHolderOrInternal`, so an account manager's credential can't
  outlast its own revocation or lock the account's owner out.
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
  since `static_file_service` cannot check keys. It caps a picture at 16 MB and a
  user at 20 uploads an hour, and signs the declared size into the upload URL so
  storage rejects any other size. `PUT` on that path takes the SFS
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
- `/internal/google_access_token` answers 403 for every grant Google refuses
  for this user (`InvalidGrant`, and `GrantBlocked` for policy codes such as
  `access_not_configured`); email and calendar callers then mark the link for
  reauthorization instead of retrying. Keep it 4xx: a 500 makes callers retry
  and trips the HTTP server-errors monitor. Macro's own OAuth client failing
  (`invalid_client`) stays a 500.
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
  time. The fleet issues new credentials through the InternalOnly enrollment route;
  repo recovery reissues its token while preserving repository contents.

- `src/outbound/computer_urls.rs` resolves bootstrap addresses separately from
  browser and service-internal URLs. Enabled local fleets require complete
  `COMPUTERS_SERVICE_URL_OVERRIDES` entries for the SDK gateway, harness egress
  and git; deployed environments use typed public URLs. The git adapter advertises
  the computer-facing remote while retaining the internal API address for create.
  Brain Anthropic credentials reuse that agent's revocable Macro API key on the
  dedicated `/brain/anthropic` gateway path.

- The HTTP boundary validates optional signed agent correlation without changing existing authorization.

Computer billing requires all six
`STRIPE_COMPUTER_{STANDARD,LARGE,XL}_{MONTHLY,YEARLY}_PRICE_ID` values to be
nonblank whenever `COMPUTERS_FLEET` is set. Validate this at startup and in the
Doppler config check; unset or explicitly disabled fleets require no computer price config; partial price groups are always rejected. Prices
have no fallback. See [required computer config](../../docs/development/running-locally.md#macro-computers).

## Persona enrollment contract

`POST /internal/team_agent_enrollment/{computer}/{generation}` requires
`InternalOnly`, never an ordinary user or agent key. It returns one-time
`PersonaEnrollment` with `Cache-Control: no-store`. The team-agent domain verifies
the generation, team, agent account and persona identity, locks the agent row,
replaces its Brain API key and reissues the repo token. No bootstrap plaintext is
persisted. A failed issuance may be repeated to revoke the incomplete attempt.
