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
   `/app/component/inbox`. The starter documents share a personal `docs` tag; the
   guide's `#` example is an inline mention of that same tag. A tag attachment
   failure does not block the remaining content; signup retries repair tags
   without resetting task priorities. The guide waits until its tag IDs resolve.

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

## Mailpit (local email)

- UI: `http://localhost:<mailpit-port>/`
- API: `curl -s http://localhost:<mailpit-port>/api/v1/messages` — newest message first.
  Login codes arrive as subject `Your Macro login code` with snippet
  `Your Macro login code: NNNNNN`.

## Known crash on first landing (local)

Immediately after login the app navigates to `/app/component/inbox` and can throw a
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
