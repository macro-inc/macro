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
   `/app/component/inbox`.

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
