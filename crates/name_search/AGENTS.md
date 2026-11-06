# name_search

## What it is

Part of the Search feature. Postgres name search over channels and chats,
used by `search_service`'s name-match path (unified `/search` in `name` and
`name_content` mode, `/search/channel/name`) and by AI tools, plus match
highlighting.

## Start here

- `src/channel.rs` + `src/channel/test.rs`: `search_channel_names`. Viewer-aware:
  a DM is found by the other participant, an unnamed private channel by any
  other member, a persona DM by its bot. The SQL match is
  `channels::outbound::channel_name::match_channel_names`; this crate splits
  the query into terms, builds the patterns, pages, resolves and highlights.
- `src/chat.rs` + `src/chat/test.rs`: `search_chat_names`.
- `src/highlight.rs`: `highlight_name` — marks up matched substrings.
- `fixtures/`: SQL seed fixtures (`channel.sql`, `chat.sql`, `chat_tags.sql`)
  used by the tests.

## Scope

- Owns: name-search patterns, cursors and highlighting for channels/chats; the
  chat name SQL.
- Not here: the channel naming rule and its SQL → `channels`
  (`src/outbound/channel_name.rs`); content/full-text search →
  `models_search`, `search_service`; the OpenSearch-indexed entity types →
  `models_opensearch`.

## Boundaries

- Depends on: `channels` (outbound feature), `models_opensearch`,
  `models_search_cursor`.
- Used by: `search_service`.

## Checks

- `cargo test -p name_search` (`SQLX_OFFLINE` unset; requires local MacroDB).
- `nix develop --command just prepare_db` from the repo root if SQLx cache
  metadata is stale.

## Related

- Rules: `.agents/rules/rust/db.md`
