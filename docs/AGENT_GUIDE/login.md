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
   the user's inbox (locally: Mailpit).
5. First login auto-creates the user, seeds onboarding content (a "Macro Support x <name>"
   channel, a "Macro how to guide" doc favorite, three sample tasks), and lands on
   `/app/home`. The starter documents share a personal `docs` tag; the
   guide's `#` example is an inline mention of that same tag. A tag attachment
   failure does not block the remaining content; signup retries repair tags
   without resetting task priorities. The guide waits until its tag IDs resolve.

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
See [Android development](../ANDROID_DEVELOPMENT.md) for build commands and
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
interests and security. No account is required for these slides. Below the color
picker, "Already have an account? Sign in instead" opens `/app/login`. At the work-email
step, Connect work email uses Google sign-up to create the Macro account and link
the primary inbox. This step offers Google sign-up only, with no alternate email
button. The chosen accent and work step survive the OAuth
redirect; after authentication the accent is saved to the user's theme and setup
resumes at work email. Regular `/app/login` retains the direct sign-in screen.

The steps are workspace color, feature interests, security, work Google account,
personal Google account, tools, team, and the trial offer. Color selection forks
the default Macro Light or Macro Dark theme for the current mode and pins the
custom accent palette; it does not modify a built-in theme. Interests are visual
preferences only. Security and Google steps have a Read more section below the fold.

Work and personal account buttons use the existing Gmail linking flow. Skipping
work email skips the secondary-account prompt. Verify that a Google return
restores the correct step, shows the connected address, and allows continuation.
Tools use the same Pipedream catalog and connection UI as Settings. Search, load
more, cancel/retry connection, and confirm connected checks persist on return.
Team setup retains existing membership, invite acceptance, domain suggestions,
and editable invite recipients; submitting the form sends real invitations.

The trial offer contains no card fields or wallet buttons. Its primary button
requests an automatic 30-day Premium trial through Stripe Checkout; no coupon
code is required. Stripe collects the payment method for billing after the trial.
Only a customer's first subscription qualifies, including canceled subscriptions
in that check. Ineligible trial requests show an error instead of opening an
immediately paid checkout. Standard purchases retain their existing billing terms.
Cancellation returns to this step. A successful return
polls the server's license state, completes onboarding, and enters the app without
an extra confirmation click. A pending webhook shows a retryable confirmation
state. The Guest scroll cue opens a comparison with a separate Guest continuation.
Both completion paths preserve an original `next` destination. Old saved email,
connector, building, and summary step names are migrated on resume.

## Public onboarding preview

The standalone marketing development route `/onboarding-preview.html` continues
from team setup to a final trial screen. The payment card starts with Apple Pay, Google Pay, and the card-number input,
with no plan header or divider. The card scrolls internally at a maximum of
360px or half the viewport height. Entering at least 15 digits in the local
preview input reveals expiration, security code, country, and ZIP previews;
clearing it hides them again. Use a test number such as `4242 4242 4242 4242`.
The primary CTA reads `Start 30 day trial`, with the billing and cancellation
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
