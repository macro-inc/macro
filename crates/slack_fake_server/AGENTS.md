# slack_fake_server

## What it is

Test support for Slack Connect sync: an in-process fake Slack that
`crates/slack_client` (and the Slack session service's tests) talk to over
real HTTP and websockets on `127.0.0.1`, so the whole client runs
deterministically without Slack.

## How it works

- `FakeSlack::start()` serves every Slack host on one port: Web API
  (`/api/<method>`, form or multipart), sign-in endpoints, edge API
  (`/cache/<team>/users/info`), uploads (`/upload/<file>`), downloads
  (`/files/<file>/<name>`), magic links and the websocket (`/websocket/`).
- Seed with Slack's own JSON shapes: `add_team`, `add_user`, `add_session`
  (token + decoded `d` cookie, both checked on every call), `add_conversation`.
- Messages sent through the API, `receive_message`, edits, deletes,
  reactions and marks push the matching event to members' sockets.
- Login state lives in cookies (`b`, `email-session`, `d`), so a client that
  loses its jar between steps fails like it would on Slack.

## Start here

- `src/lib.rs`: the test-facing API (seed, inject, observe, wait).
- `src/web_api.rs`: Web API methods; `src/login.rs`: sign-in; `src/routes.rs`:
  routing, auth checks, the socket loop.

## Checks

- `cargo test -p slack_client` exercises it.

## Gotchas

- Waits are event driven (`wait_for_*` re-check on every change); don't add
  sleeps.
- `end_session` makes calls answer the code and closes sockets; handshakes
  then get 401, so the client classifies via `auth.test`.
- `rate_limit_next(method, Duration::ZERO)` tests the 429 path without
  waiting.
- Unknown methods answer `unknown_method`; add a handler when the client
  learns one.

## Related

- `crates/slack_client/AGENTS.md`, `crates/whatsapp_fake_server/AGENTS.md`
