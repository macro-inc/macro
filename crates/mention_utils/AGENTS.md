# mention_utils

## What it is

Shared infrastructure for the `@mention` feature, used by messages,
documents, and notifications. Parses and serializes `@mention` XML chips
(`<m-user>`, `<m-channel>`, `<m-bot>`, GitHub PR links, etc.) shared between
AI editors, lexical, and notification text.

## Start here

- `src/parse.rs`: `nom` parsers for each mention chip XML tag, and the
  formatters (`PlainTextFormatter`) that turn tagged text into plain text for
  notification bodies, digests, and search.
- `src/serialize.rs`: writes mentions as chip XML.
- `src/tests.rs`: round-trip parse/serialize cases.

## Scope

- Owns: the mention chip wire format (XML-ish tags embedded in message/doc
  text) and parsing it into typed references (`macro_user_id`, `BotIdStr`,
  `ChannelSender`, GitHub PR URLs).
- Not here: rendering mentions in the UI (web app), or deciding who gets
  notified for a mention → `model_notifications`, `messages`.

## Boundaries

- Depends on: `bot_id`, `channel_sender`, `macro_user_id`, `nom`, `mention_date`.
- Reuse `mention_date::bare_date_label` for bare ISO mention labels.
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
- Agents leave `documentName` empty or omit it (the app shows the live name),
  so `PlainTextFormatter` writes a nameless document mention as its kind in
  angle brackets (`<task>`, `<message>`). Escape that text wherever it lands
  in HTML.
