# gmail_emulator

## What it is

Test support for the Email feature: a stateful fake of the Google APIs our
email code calls. The real `gmail_client`, `email_api_client`, `email_service`
and its workers run against it, in a `cargo test` or as a standalone process,
without Google accounts.

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
- `src/gmail_routes.rs`, `src/google_routes.rs`: Gmail REST; People, OAuth
  and certificates. `src/control.rs`: `/_emulator/`.
- `src/test/`: the real client and adapter against the emulator.

## Scope

- Owns: the Google endpoints the email code calls. Add an endpoint when the
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
- The signing key is generated on first use (a few seconds in a debug build)
  and differs per emulator. Don't commit a key: the secret scan refuses it.
- Waiting is event driven (`wait_for_push_deliveries`); don't add sleep loops.
- `q` understands only the operators listed in `src/query.rs`; `OR` and
  parentheses match as plain words.
- The authentication-service stand-in is not a Google API. It exists so the
  service can run without FusionAuth, and answers like the real route: 404 for
  an unknown account, 403 for a revoked grant.

## Related

- Rules: `.agents/rules/config-and-service-urls.md` ·
  `crates/gmail_client/AGENTS.md`, `services/email_service/AGENTS.md` (running the service)
