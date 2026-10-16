# name_search

## What it is

Part of the Search feature. Postgres queries for server-side name search
over channels and chats (used by AI tools and `search_service`'s name-match
path), plus match highlighting.

## Start here

- `src/channel.rs` + `src/channel/test.rs`: `search_channel_names`.
- `src/chat.rs` + `src/chat/test.rs`: `search_chat_names`.
- `src/highlight.rs`: `highlight_name` — marks up matched substrings.
- `fixtures/`: SQL seed fixtures (`channel.sql`, `chat.sql`, `chat_tags.sql`)
  used by the tests.

## Scope

- Owns: name-search SQL queries and result cursors for channels/chats.
- Not here: content/full-text search → `models_search`, `search_service`;
  the OpenSearch-indexed entity types → `models_opensearch`.

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
