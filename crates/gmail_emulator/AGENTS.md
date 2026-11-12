# gmail_emulator

## What it is

Test support for the Email feature: a stateful fake of the Google APIs our
email and sign-in code call. The real `gmail_client`, `email_api_client`,
`email_service` and its workers, FusionAuth's Google identity providers and
the authentication service's Gmail link run against it, in a `cargo test`, as
a standalone process or as part of a local stack, without Google accounts.

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
- `src/gate.rs`: what every request passes: token, faults, quota, request log.
- `src/gmail_routes.rs`, `src/google_routes.rs`: Gmail REST; People, the
  OAuth token endpoint and certificates. `src/control.rs`: `/_emulator/`.
- `src/sign_in.rs` and `templates/`: the sign-in page, authorization codes,
  ID tokens and userinfo.
- `src/test/`: the real client and adapter against the emulator.

## Scope

- Owns: the Google endpoints the email and sign-in code call. Add an endpoint when the
  code starts calling it, not before.
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
  `OVERRIDE_GOOGLE_OAUTH_CERTS_URL=<base>/oauth2/v3/certs`, and
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
  client.

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
- The authentication-service stand-in is not a Google API. It exists so the
  service can run without FusionAuth, and answers like the real route: 404 for
  an unknown account, 403 for a revoked grant.

## Related

- Rules: `.agents/rules/config-and-service-urls.md` ·
  `crates/gmail_client/AGENTS.md`, `services/email_service/AGENTS.md` (running the service)
