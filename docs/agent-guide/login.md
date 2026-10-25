# Login

## Flow

1. Navigate to `/app`. Unauthenticated sessions land on `/app/welcome`.
2. Click the button named `Continue with email` in the a11y tree. (One click sometimes only
   focuses it — if no form appears in the next snapshot, click again.)
3. `fill` the textbox labeled `you@company.com` with the email, click `Continue`.
4. On the local stack the auth service is built with `return_passwordless_code`: the login
   response carries the one-time code and the frontend auto-verifies it, so you are logged in
   immediately — no code entry step ever appears. A code email is still sent and visible in
   Mailpit. Against a real deployment, expect a code-entry step instead: fetch the code from
   the user's inbox (locally: Mailpit). The sixth digit submits the code. A rejected code
   clears the boxes and refocuses them for retyping. The auth service allows five code
   checks a minute per address; past that the step shows "Too many attempts. Wait a minute,
   then try again." and keeps the code. Requesting a new code does not lift that wait.
5. First login auto-creates the user, seeds onboarding content (a "Macro Support x <name>"
   channel, a "Macro how to guide" doc favorite, three sample tasks), and lands on
   `/app/home`. The starter documents share a personal `docs` tag; the
   guide's `#` example is an inline mention of that same tag. A tag attachment
   failure does not block the remaining content; signup retries repair tags
   without resetting task priorities. The guide waits until its tag IDs resolve.

Production Google/SSO and inbox/calendar connections may return to either
`https://macro.com` or `https://www.macro.com`. Verify connections from both hosts;
the web inbox link flow returns to `/app/inbox-link-callback` on the originating host.

On desktop, connecting a Gmail or Outlook account, reconnecting one, or enabling
calendar opens the selected provider's consent in the system browser. The app
stays open; the callback is
`macro:///inbox-link-callback?link_id=...`, which provisions the inbox using the
existing app session and restores the saved layout, including its query and hash.
Verify each enabled provider, including reconnects with email-only and calendar
permissions. Check that opening consent alone does not report an account
connected, that returning from consent shows the second account, and that
canceling leaves the app usable. iOS and Android continue to use their native
authentication sessions.

## Temporary open signup in Develop

Once the temporary authentication-service override is deployed, Develop accepts
new accounts with any email address regardless of signup allowlist membership or
the configured bypass flag. Verify with an authorized test account outside
`macro.com` that is absent from the allowlist. Email verification and provider
sign-in still apply. See the [authentication-service configuration guide](../../services/authentication_service/README.md#temporary-open-signup-override)
for restoring allowlist enforcement.

## GraphQL cache session lifecycle

Signed-out pages use the network client without creating the GraphQL cache,
draft queue runner, or live-update subscriptions. Signing in activates them in
the same tab, including after a session expiry. Queued draft writes wait for
authenticated user info; unrelated mutations can continue draining.

Verify expiry followed by signing into a different account without reloading:
the new account's lists must load and receive live updates, and the previous
account's cached data must be absent. Logout wipes local caches before retiring
their clients. Mounted query observers must receive the next account's data
after the wipe. Previous account data must not return through initial data,
placeholder data, or a later query reset.

## CI deploy-preview authentication

PR previews at `https://<id>.preview.macro.com/app` use the dev backend and
its shared `.macro.com` HttpOnly cookies (`dev-macro-access-token` and
`dev-macro-refresh-token`). The `login` hint is host-only and `macro:login`
localStorage is origin-scoped, so a fresh preview has neither. Preview startup
must check identity anyway; the hostname is not proof of authentication.
Account queries and WebSockets still wait for a confirmed authenticated user.

Verify in a browser signed into `https://dev.macro.com`: open a fresh preview
hostname (or clear only that preview's localStorage and `login` hint, keeping
the shared dev cookies). It should request
`https://dev-gateway.macro.com/auth/user/legacy_user_permissions` and enter the
signed-in app without another login. Repeat in a clean browser context: the
identity check should fail without starting account services, and a public
document should remain readable. Ordinary signed-out public links without a
login hint should not start identity checks or account services.

## Hosted-dev proxy SSO

On an allowed OAuth origin such as `https://localhost:<port>`, Google/SSO
sign-in navigates the browser to `/__macro_dev/gateway/auth/login/sso` with
`is_mobile=true` to request the session-code handoff. The `original_url`
remains the browser destination (including its query and hash). Returning
from the provider redeems the session code to establish cookies locally.
This browser flow must not open a native authentication session. Verify the
redirect separately from provider completion; arbitrary development hostnames
are not on the hosted OAuth redirect allowlist.

## Native iOS 27

The native welcome screen offers `Create new account` and `Log into existing
account` before the login form. Startup and background/foreground resume work
with the scene lifecycle enabled; Macro remains single-window on iPhone and
iPad. The iPad welcome screen can show an `Optimized for iPhone` notice.
Mobile resume is delivered per window, independently of ordinary focus changes.
A custom-scheme link to `macro://app/login` now opens the login form both
while Macro is running and when it cold-starts the app. Verify both cases
separately. When signed out, an ordinary launch with no URL should show the
welcome screen. When signed in, the session should survive restart and the app
should open its authenticated landing view without replaying an old deep link.
For simulator checks, `xcrun devicectl device process launch --device <udid>
--payload-url 'macro://app/login' com.macro.app.prod` delivers the link without
`simctl openurl`'s confirmation dialog. Terminate Macro first for the cold case.
Signed universal links and share-sheet flows still need end-to-end verification;
see the [Tauri guide](../../apps/web/tauri/src-tauri/README.md#ios-27-scene-lifecycle)
and [repeatable iOS smoke test](../../apps/web/tests/native/ios/README.md).

## Signed-out GraphQL regression

Open a public sharing link with stale login hints and an expired session. Once
user-info returns 401, GraphQL must use the plain network client, dispose any
normalized cache and live-update session, and clear the login hints. Repeat with
retained user-info data from an earlier successful request. A network failure or
5xx must not end the session; successful sign-in must re-enable eligible caching.

## Native Android

If a signed-out page shows the bottom `Login` / `Sign Up` banner, both buttons
must sit above Android's navigation bar. Verify that `Login` is tappable with
three-button navigation as well as gesture navigation.

The Android welcome screen also offers `Create new account` and `Log into existing
account`. Google sign-in opens a system browser Auth Tab; completing or canceling
returns to Macro. Cancel and retry should open a fresh attempt. Enter provider
passwords and verification codes only in that browser, never in agent messages.
For browsers using the Custom Tabs fallback, verify that the callback returns to
the original Macro task. A callback for another attempt must leave the current
attempt pending; a callback after process death must not restore that attempt.

After signing in, test background/foreground, force-stop/relaunch, logout, and
signing in as another account. An entity link opened while signed out should
remain pending until authentication completes. The destination expires after
30 minutes and explicit logout clears it. Test both cold and warm delivery;
forcing an Android intent to Macro proves routing, not verified App Links.
Root links must preserve query parameters through the welcome or inbox redirect,
including when Android delivers the link after the session gate mounts. Test
with a harmless marker query; checkout return parameters can trigger analytics
and license refreshes and should only be exercised in a checkout test.
See [Android development](../development/android.md) for build commands and
certificate-dependent domain verification. Provider completion, account linking,
and verified links still require end-to-end qualification.

## GitHub reconnect prompt

On native mobile, the `Reconnect GitHub` prompt hides while the authentication
browser is open. Canceling or failing authentication restores the prompt so the
user can retry; successful reconnection keeps it hidden. Verify cancel followed
by retry, browser failure, and failure to start OAuth. Repeated taps while a flow
is pending must start only one attempt. On the web, a successful OAuth kickoff
navigates away and the prompt stays hidden during that navigation.
Use browser Back to return from GitHub: when the page is restored from BFCache,
it refreshes link status and restores the retry prompt only if reconnection is
still needed.

## Desktop onboarding

New desktop users enter the same flow from
`/app/signup`, `/app/login`, or `/app/onboarding`. Marketing Get Started links
open `/app/signup`. Existing members and native mobile keep their existing routes.

Signed-out `/app/signup` starts at the workspace color picker, followed by feature
interests and security. No account is required for these slides. The signed-out
page should remain stable after the session check returns
401; it must not alternate with the loading screen or reset a selected color.
Verify that Continue advances without signing in. Below the color
picker, "Already have an account? Sign in instead" opens `/app/login`. At the work-email
step, Connect work email uses Google sign-up to create the Macro account and link
the primary inbox. This step offers Google sign-up only, with no alternate email
button. The chosen accent and work step survive the OAuth
redirect; after authentication the accent is saved to the user's theme and setup
resumes at work email. Regular `/app/login` retains the direct sign-in screen.

Onboarding follows the app's light/dark setting. Light mode uses the marketing
cream background, black headings, muted warm text, and brighter ivory inputs and
integration tiles. Dark mode retains its black palette. Verify both modes at
desktop and mobile widths, including the below-fold security and pricing details.
For a safe local walkthrough with simulated connections and billing, use the real
view fixture documented in `apps/web/src/features/onboarding/browser-test/README.md`;
`/?view=flow&theme=cream` forces its cream preview without changing account settings.

The steps are workspace color, feature interests, security, work Google account,
personal Google account, tools, team, and plan selection. Color selection forks
the default Macro Light or Macro Dark theme for the current mode and pins the
custom accent palette; it does not modify a built-in theme. Cream mode hides
Pearl and centers the remaining five swatches. A selected Pearl falls back to Mint
when entering cream mode; Pearl stays available in dark mode. Cream slab headings use weight 330
(15 above dark mode) with the same sizing and line breaks. Interests are visual
preferences only. Security and Google steps have a Read more section below the fold.

Work and personal account buttons use the existing Gmail linking flow. Skipping
work email skips the secondary-account prompt. Verify that a Google return
restores the correct step, shows the connected address, and allows continuation.

Tools show a stable featured list: Linear, Notion, Slack, then startup tools
such as PostHog and Stripe, followed by small-business tools such as QuickBooks.
The featured Pipedream metadata is checked in; the remaining catalog uses one
live paginated query. Search still covers the full directory. Verify load more,
search, cancel/retry connection, and state persistence on return. Paging and
Slack aliases must not duplicate cards. New Slack connections use `slack_v2`;
existing `slack` accounts remain recognized. Production release requires a real
Slack authorization and a successful read-only tool call, not just fixture tests.
Cards use the Pipedream logo, with bundled icons and a generic plug as fallbacks.
The catalog scrolls with the page; Continue stays visible in a sticky footer.
At desktop and phone widths, verify scrolling over the cards moves the page,
the last row remains reachable, and Continue stays fully visible after searching.

GitHub uses Macro's native OAuth/re-authorization flow and returns to the tools
step. It shows **Account linked**, distinct from agent-tool readiness. A
**Configure GitHub repositories** action opens native GitHub App installation;
repository access must not be inferred from the account link. No Pipedream
GitHub card is offered. The same setup remains available in Settings.

Gmail and Google Calendar are hidden, including search and later pages. Google
Drive and Google Sheets remain available in browse and search, with separate
Pipedream connection state. Native Gmail and Calendar consent does not request
Drive or Sheets scopes. Enabled native MCP and Pipedream connections show
Connected. Disabled existing connections show Enable and reuse their stored
authorization. Native and hosted tools coexist in both chat and sandbox agents,
with native preference for known overlapping providers and Slack alias deduplication.
Connection status failures have an explicit retry; they must not prevent
independent providers such as native GitHub from connecting. Verify unknown
status never launches a duplicate OAuth flow and continuation remains possible.
Team setup retains existing membership, invite acceptance, domain suggestions,
and editable invite recipients; submitting the form sends real invitations.
On the create-team form, type a workspace name and edit a teammate address,
then allow onboarding/contacts queries to refresh. The same inputs must retain
their values and focus as suggestions arrive or a background request fails.
Pending queries must show local loading states without suspending the flow.

Members with an active or trialing license, including a license from their team,
finish directly from the team step without visiting the plan page. The Continue
button reads "Opening your workspace…" while saving; a failed save leaves the
team step available to retry. Checkout returns still use the plan step to confirm
payment. Session refreshes must preserve the mounted onboarding flow so
completion finishes instead of repeatedly flashing or restarting.

Finishing setup saves the onboarding record before marking the tutorial complete.
The confirmed tutorial save updates the session cache before leaving. A successful
finish must not show "Couldn't finish setup — please try again", including when
a background session refresh overlaps it.

The final screen shows “Free Claude & GPT for 30 days” and the trial button
only after the server confirms first-subscription eligibility. Returning
customers without an existing subscription see “Get more with Pro.” and
`Get Pro` with paid monthly terms. Existing subscribers see `Manage subscription`
to review their subscription and payment details. The “See more” scroll cue opens the pricing grid
below, comparing Free, Pro, and Max. The grid loads monthly subscription prices
from the billing catalog and describes Max as 10× Pro usage, without displaying
dollar-denominated included AI allowances. Monthly prices use the compact
`/usr/mo` unit on one line; Free email branding reads “Sent with Macro”.
Free completes onboarding without a
card. Pro returns to the account-specific Pro offer; Max starts standard paid checkout.
The trial button requests 30 days free through Stripe Checkout, with no coupon
required. Stripe collects the payment method for billing after the trial. Only a
customer's first subscription qualifies, including canceled subscriptions in that
check. Eligibility loading or failure disables Pro checkout without advertising
a trial; a failed lookup offers `Try again`. A trial rejected at checkout
shows the server explanation and refreshes eligibility, without automatically
retrying as a paid purchase. Invite promotions retain their own offer and terms.
Cancellation returns to this step. A successful return polls the server's license
state, completes onboarding, and enters the app without an extra confirmation
click. A pending webhook shows a retryable confirmation state. If the catalog
cannot load, Free remains available, Pro still returns to its offer, and
Max checkout stays disabled until prices can be loaded with the retry action.
Both completion paths preserve an original `next` destination and otherwise land on Home (`/app/home`). Old saved email,
connector, building, and summary step names are migrated on resume.

## Public onboarding preview

The standalone marketing development route `/onboarding-preview.html` continues
from team setup to a final trial screen. The payment card starts with Apple Pay, Google Pay, and the card-number input,
with no plan header or divider. The card scrolls internally at a maximum of
360px or half the viewport height. Entering at least 15 digits in the local
preview input reveals expiration, security code, country, and ZIP previews;
clearing it hides them again. Use a test number such as `4242 4242 4242 4242`.
For eligible customers, the primary CTA reads `Start 30 day trial`, with the billing and cancellation
note immediately below it. The quiet `Continue as Guest` scroll cue beneath it
moves focus to the below-fold Guest and Pro comparison,
using the same layout as the security details. The table includes email account
limits, the email watermark, AI, storage, and calls. Each comparison column ends
with its own compact CTA. `Continue as Guest`
finishes the preview without a confirmation modal; `Continue with Pro` in the
comparison returns to the payment section and its heading.
Reduced-motion users scroll immediately. Wallet buttons only display a
preview message. The card number stays in the input only and is never sent or
saved; the remaining fields are display-only. Both plan
continuation buttons finish the preview at the login URL; they do not purchase a
subscription. Back returns to team setup. This payment mock remains preview-only; the authenticated flow instead opens
Stripe Checkout as described above.

## Mailpit (local email)

- UI: `http://localhost:<mailpit-port>/`
- API: `curl -s http://localhost:<mailpit-port>/api/v1/messages` — newest message first.
  Login codes arrive as subject `Your Macro login code` with snippet
  `Your Macro login code: NNNNNN`.

## Known crash on first landing (local)

Immediately after login the app navigates to `/app/home` and can throw a
full-screen error dialog: **"Something went terribly wrong — Cannot read properties of
undefined (reading 'id')"**. Console shows `Failed to init email link on login` with a 404 on
`GET /auth/link/github/status` and a 400 on `POST /email/email/init`. This is cosmetic-ish and
fully recoverable: click the dialog's `Home` button, then wait for the sidebar text
`Go to Email` to appear.

## Session persistence

The session lives in cookies (`local-macro-access-token`, `local-macro-refresh-token`). It
survives page reloads but not a browser-profile restart — if the shared Chromium is restarted
with a fresh profile you must log in again. Workspace data (docs, channels, tasks) persists on
the backend across logins for the same email.
