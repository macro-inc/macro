# mention_utils

## What it is

Shared infrastructure for the `@mention` feature, used by messages,
documents, and notifications. Parses and serializes `@mention` XML chips
(`<m-user>`, `<m-channel>`, `<m-bot>`, GitHub PR links, etc.) shared between
AI editors, lexical, and notification text.

## Start here

- `src/parse.rs`: `nom` parsers for each mention chip XML tag.
- `src/serialize.rs`: renders mentions back to chip XML or plain text.
- `src/tests.rs`: round-trip parse/serialize cases.

## Scope

- Owns: the mention chip wire format (XML-ish tags embedded in message/doc
  text) and parsing it into typed references (`macro_user_id`, `BotIdStr`,
  `ChannelSender`, GitHub PR URLs).
- Not here: rendering mentions in the UI (web app), or deciding who gets
  notified for a mention → `model_notifications`, `messages`.

## Boundaries

- Depends on: `bot_id`, `channel_sender`, `macro_user_id`, `nom`.
- Used by: `authentication_service`, `model_notifications`, `notification_service`,
  `scheduled_action`, `search_processing_service`, `slack_import_worker`,
  `slack_integration`.

## Recipes

- Add a new mention chip type: `src/parse.rs` (new `nom` parser + tag) →
  `src/serialize.rs` (render it back) → `src/tests.rs`.

## Checks

- `cargo test -p mention_utils` (`SQLX_OFFLINE` unset).

## Gotchas

- New chip parsers should use `nom`, matching the rest of this crate, rather
  than hand-rolled string scanning.
