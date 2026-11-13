# slack_client

## What it is

Part of external chats (Slack Connect next to WhatsApp). A typed Rust client
for the Slack **web client's session**: the `xoxc-` token and `d` cookie a
browser holds. Login, the Web API methods a chat client needs, and the
real-time websocket. An outbound adapter library: no DB, no Macro entities.

## Start here

- `src/lib.rs`: the public surface (re-exports).
- `src/client.rs`: `SlackClient`, the one HTTP path (`call` / `call_edge`):
  token in the form body, cookie + `Origin` headers, tier pacing, 429 retry,
  one `slack.api` span per call. `download_file` refuses non-Slack hosts.
- `src/api/*.rs`: methods by area; `src/models/*.rs`: wire types with
  Slack Connect fields; `src/method.rs`: `SlackMethod` + rate tiers.
- `src/login.rs` (+ `login/http.rs`): email sign-in as a serde-resumable
  `LoginState` machine; `EmailLogin::step(state, input)`.
- `src/realtime.rs` (+ `realtime/events.rs`): `connect_realtime`, reconnect
  loop, typed `SlackEvent`s; unknown frames stay raw JSON.
- `src/error.rs`: `SlackError` / `SlackErrorCode` with `is_session_ended()`.
- `src/emoji.rs`: Slack reaction names ↔ the Unicode emoji Macro stores, from
  the generated `data/emoji-shortcodes.json` (regenerate per `data/README.md`).

## Scope

- Owns: talking to Slack as the user's web session.
- Not here: storage, sealing credentials, mapping to Macro chats →
  `crates/slack_linked`; mrkdwn parsing → `crates/slack_integration`.

## Recipes

- Add a method: variant + tier in `method.rs` → `api/<area>.rs` → a handler
  in `crates/slack_fake_server/src/web_api.rs` → test in `src/test.rs`.
- Add an event: struct + `SlackEvent` variant in `realtime/events.rs` (its
  snake_case name is the frame `type`) → push it from the fake.

## Checks

- `cargo test -p slack_client` (runs against `slack_fake_server`).
- Live smoke (Wolf's session, read-only; prints counts and ids only):
  `SLACK_LIVE_SESSION=/home/wolf/tmp/slack/creds/session.json cargo test -p slack_client --test live -- --ignored --nocapture`.

## Gotchas

- `SlackEndpoints` is the only host config: `production()` or a fake's URLs.
  Web API calls go to the workspace URL from `auth.test` (`<url>api/…`),
  which routes Grid shards; `validate_session` uses `slack.com` before the
  workspace is known.
- Never log `Secret`, `SessionCredentials`, `LoginState`, websocket URLs (the
  token is in the query) or `reconnect_url`. Debug output is redacted.
- `LoginState` holds the cookie jar and magic codes: seal it before storing.
- wss needs a rustls crypto provider installed by the binary
  (`rustls::crypto::aws_lc_rs::default_provider().install_default()`).
- No `traceparent` goes to Slack; spans stop at this crate.
- Ported from mautrix-slack (AGPL-3.0) and beeper/slackgo + slack-go
  (BSD-2-Clause, Copyright (c) 2015 Norberto Lopes); see `NOTICE`.

## Related

- Rules: `.agents/rules/observability.md`, `.agents/rules/rust/` ·
  Fake: `crates/slack_fake_server/AGENTS.md`
