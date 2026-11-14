# gmail_emulator

## What it is

Test support for the Email and Calendar features: a stateful fake of the
Google APIs our email, calendar and sign-in code call. The real
`gmail_client`, `email_api_client`, `email_service` and its workers, the
Google Calendar adapter of `calendar_events`, `calendar_service`,
FusionAuth's Google identity providers and the authentication service's Gmail
link run against it, in a `cargo test`, as a standalone process or as part of
a local stack, without Google accounts.

## How it works

- `GmailEmulator::start(seed)` listens on a `127.0.0.1` port; `cargo run -p
  gmail_emulator -- --seed <file>` is the same emulator as a process.
- It holds any number of mailboxes. An access token names its mailbox, so
  `users/me` is whoever the bearer token belongs to. Unknown, expired and
  revoked tokens answer 401.
- Every change (delivery, send, label change, delete) gets the mailbox's next
  history id. `history.list` answers 404 for a `startHistoryId` older than a
  week of the emulator's clock, or after `expire_history`.
- After `users.watch`, a change posts a Pub/Sub-style notification to the
  push endpoint, with a token signed by a key the emulator generates and
  serves at `/oauth2/v3/certs`, so `GmailClient::verify_google_token` passes.
- Every mailbox is also a Google user. `/o/oauth2/v2/auth` is a page that
  lists them in place of Google's account chooser and consent screen; picking
  one redirects back with an authorization code, which `/token` exchanges for
  an access token, a refresh token and an ID token signed by the same key.
  `/v1/userinfo` names the token's user.
- Every mailbox is also a Google Calendar user, with a primary calendar and
  any others its seed lists. A recurring event is expanded in the zone its
  start names; changing or deleting one occurrence stores an exception under
  Google's instance id (`<event id>_<start>`). A listing ends with a sync
  token that later reports only what changed, deleted events as tombstones,
  and answers 410 `fullSyncRequired` after `expire_sync_tokens`.
- A meeting's guests who are users of the emulator hold their own copy on
  their primary calendar, as at Google: an answer travels to the organizer's
  copy and every other, and a guest changes only what the organizer's guest
  switches allow. Google takes 15 to 30 seconds to carry a change to the
  other copies; the emulator does it at once unless a test asks for the lag:
  between `hold_event_copies` and `release_event_copies` a change shows only
  on the calendar it was made on.
- After `events.watch`, a change posts Google's header-only notification to
  the address the channel was opened with, first a `sync` one for the channel
  itself.
- A local stack with no real Google client runs it as the `gmail_emulator`
  sidecar (`xtask_local`'s `google_emulator.rs`), seeded from
  `seed.example.yaml`.
- `/_emulator/…` is the control API; each route calls the `GmailEmulator`
  method of the same purpose.

## Start here

- `src/lib.rs`: `GmailEmulator`, its URLs and its control methods.
- `src/seed.rs`: the seed file (YAML or JSON) and `NewMessage`;
  `seed.example.yaml` is one that a test keeps valid.
- `src/mailbox.rs`: messages, labels, history, threading, watch, quota.
- `src/state.rs`: tokens, faults, the clock, `send` and delivery between
  mailboxes.
- `src/calendar.rs`: calendars, stored events, listings, sync tokens;
  `calendar/time.rs` recurrence, `calendar/write.rs` writes and guest
  copies, `calendar/channel.rs` push channels. `src/calendar_routes.rs`:
  Calendar REST. `src/control/calendar.rs`: its control API.
- `src/gate.rs`: what every request passes: token, faults, quota, request log.
- `src/gmail_routes.rs`, `src/google_routes.rs`: Gmail REST; People, the
  OAuth token endpoint and certificates. `src/control.rs`: `/_emulator/`.
- `src/sign_in.rs` and `templates/`: the sign-in page, authorization codes,
  ID tokens and userinfo.
- `src/test/`: the real client and adapter against the emulator.

## Scope

- Owns: the Google endpoints the email, calendar and sign-in code call. Add an
  endpoint when the code starts calling it, not before.
- Not here: Microsoft Graph; SQS, Postgres and the other Macro services a
  local `email_service` needs.

## Recipes

- In a test: `GmailEmulator::start(Seed::with_mailboxes(["a@example.com"]))`,
  then `GmailClient::new_with_urls(topic, emulator.gmail_url(),
  emulator.people_url(), emulator.certs_url(), audience)` and
  `emulator.access_token("a@example.com")`.
- Point a local `email_service` and `pubsub_workers` at it:
  `OVERRIDE_GMAIL_API_URL=<base>/gmail/v1`,
  `OVERRIDE_GOOGLE_PEOPLE_API_URL=<base>/people/v1`,
  `OVERRIDE_GOOGLE_OAUTH_CERTS_URL=<base>/oauth2/v3/certs`,
  `OVERRIDE_GOOGLE_OAUTH_TOKEN_INFO_URL=<base>/oauth2/v3/tokeninfo` (on
  `email_service` only), and
  `OVERRIDE_AUTH_SERVICE_URL=<base>/_emulator/authentication-service` to get
  access tokens without the authentication service. Start the emulator with
  `--push-endpoint http://<email_service>/gmail/webhook`.
- Point sign-in and Gmail linking at it:
  `OVERRIDE_GOOGLE_OAUTH_TOKEN_URL=<base>/token`,
  `OVERRIDE_GOOGLE_OAUTH_REVOKE_URL=<base>/revoke` and, as the browser
  reaches it, `OVERRIDE_GOOGLE_OAUTH_AUTHORIZATION_URL=<base>/o/oauth2/v2/auth`;
  give FusionAuth's `google` and `google_gmail` providers the same
  authorization and token endpoints and `<base>/v1/userinfo`. A local stack
  does all of this by itself.
- Calendar in a test: `GoogleCalendarClient::new_with_url(client,
  emulator.calendar_url())` with `emulator.access_token(..)`; seed events as
  `SeedCalendar { events, .. }` or add them with `emulator.add_event`.
- Point a local `calendar_service` at it:
  `OVERRIDE_GOOGLE_CALENDAR_API_URL=<base>/calendar/v3`,
  `OVERRIDE_AUTH_SERVICE_URL=<base>/_emulator/authentication-service`, and
  for push `CALENDAR_WATCH_WEBHOOK_URL=http://<calendar_service>/notifications`
  with any `CALENDAR_WATCH_TOKEN`. An inbox syncs once its Google grant is
  recorded with the two calendar scopes (`apply_google_grant`).
- Change a calendar as its owner would in Google Calendar:
  `POST /_emulator/mailboxes/{email}/calendars/{calendar}/events` (an event
  resource, as `events.insert` takes it), `PATCH` and `DELETE`
  `…/events/{id}`, where an instance id addresses one occurrence. A guest's
  answer: `POST …/events/{id}/responses`. An expired sync token:
  `POST …/calendars/{calendar}/sync-tokens/expire`, or a `gone` fault on
  `events.list`. What was pushed: `GET /_emulator/push/channel-deliveries`.
  One calendar Google cannot list while the account's others are fine:
  `POST …/calendars/{calendar}/failure` with `{"error": "internal"}`,
  `DELETE` to end it. Google's lag before a change reaches a meeting's other copies:
  `POST /_emulator/calendar/copies/hold`, then `…/copies/release`.
- Sign in without a browser: `POST /o/oauth2/v2/auth` with the authorization
  request's parameters as a form, plus `user=<email>` and one `granted=<scope>`
  per scope to grant; the `Location` header carries the code.
- New mail: `POST /_emulator/mailboxes/{email}/messages` (`deliver`).
  Provider failure: `POST /_emulator/faults` (`inject_fault`) with a `route`
  such as `messages.get` and an `error` such as `rate_limit`. Time:
  `POST /_emulator/clock/advance`. What it received: `GET /_emulator/requests`.
- Add a Gmail endpoint: a `Route` variant with its quota units in
  `src/fault.rs` → a handler through `gate::mailbox_request` in
  `src/gmail_routes.rs` → a test in `src/test/` that calls it with the real
  client. A Calendar endpoint goes the same way through
  `src/calendar_routes.rs` and `src/test/calendar/`.

## Checks

- `cargo test -p gmail_emulator`

## Gotchas

- It only listens where it is told to, `127.0.0.1` by default. Never give it
  real mail or real tokens.
- Responses are Google's shapes, not ours: absent fields are omitted, not
  null, and carry fields `models_email` does not read. Don't build them from
  `models_email` types.
- Push tokens are dated by the real clock, because the verifier reads the
  real clock; everything else follows the emulator's clock.
- Scopes add to the grant a mailbox already holds, as at Google, and a
  seeded mailbox starts with every scope granted. Unchecking a scope on the
  page only withholds it from a mailbox whose grant was revoked or seeded
  with `scopes: []`.
- A consent after a revocation starts a new grant with a new refresh token;
  the revoked one stays dead.
- The emulator accepts any client id and secret. A code is bound to the
  client id and redirect URI it was issued for.
- The signing key is generated on first use (a few seconds in a debug build)
  and differs per emulator. Don't commit a key: the secret scan refuses it.
- State lives in memory. Recreating the process or its container starts
  again from the seed: delivered mail, grants made on the page and watches
  are gone, so mailboxes linked before then get no pushes until they watch
  again.
- On the routes without a mailbox token (the sign-in page, `/token`), a
  fault that names no mailbox answers before anything changes, so a failed
  code exchange can be retried. A fault that names a mailbox answers after
  the request took effect.
- Waiting is event driven (`wait_for_push_deliveries`); don't add sleep loops.
- `q` understands only the operators listed in `src/query.rs`; `OR` and
  parentheses match as plain words.
- An event is stored as Google's own JSON object and patched as Google
  patches: `null` removes a field, an object merges, an array replaces. An
  event id is base32hex (`0-9`, `a-v`, five characters or more); a seed that
  names another is refused.
- A calendar id in a seed is whatever the seed says. A `secondary: true`
  calendar gets one shaped like Google's (`c_…@group.calendar.google.com`).
- Calendar channels accept an `http` address, which Google refuses, because
  a local webhook has no certificate. A notification is sent again only
  after 500, 502, 503, 504 or no answer, as Google does.
- Not emulated, because our code does not depend on it: invitation mail for
  `sendUpdates`, ACLs and calendars shared between users (each user's list
  holds its own calendars), free/busy, `updatedMin` and `q` on `events.list`,
  `singleEvents` with a sync token, and the `_R` ids of a split series.
  A change reaches a guest's copy at once unless copies are held back; a
  hold carries changes to one copy of a meeting, not a merge of changes made
  to two of its copies.
- Three answers are the emulator's reading, not checked against Google:
  patching a deleted event answers 400, `events.instances` of an event that
  does not repeat answers the event itself, and a guest's forbidden change
  answers 403 `forbiddenForNonOrganizer`.
- The authentication-service stand-in is not a Google API. It exists so the
  service can run without FusionAuth, and answers like the real route: 404 for
  an unknown account, 403 for a revoked grant.

## Related

- Rules: `.agents/rules/config-and-service-urls.md` ·
  `crates/gmail_client/AGENTS.md`, `services/email_service/AGENTS.md` (running the service),
  `crates/calendar_events/AGENTS.md`, `services/calendar_service/AGENTS.md`
