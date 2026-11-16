# lexical_client

## What it is

Belongs to Documents: the Rust-side HTTP client for `lexical_service`, plus
a parser for Lexical's markdown subset, used by any backend crate that needs
to read or render document content.

## Start here

- `src/lib.rs`: `LexicalClient::new` — builds the `reqwest::Client`, sets the
  internal-access header, and trusts the checked-in local CA for local HTTPS.
- `src/parse_markdown.rs` (+ `src/parse_markdown/test.rs`): markdown → Lexical
  node tree parsing.
- `src/types.rs`: the Lexical node/document types shared with the service.
- `src/notion.rs`: `notion_to_loro_snapshot` (`POST /snapshot/notion`) and its
  hand-copied request types; keep them in step with
  `services/lexical-service/src/endpoints/notion-snapshot.ts`.

## Scope

- Owns: the Rust-side HTTP client for `lexical_service` and markdown parsing
  into Lexical's node shape.
- Not here: the service itself, or the frontend's own Lexical node
  implementations (`apps/web`) — those are kept in sync by hand, not shared
  code.

## Boundaries

- Depends on: `agent_fold`, `messages`, `trigger_context`.
- Used by: `documents`, `collab_surface`, `email`, `ai_tools`, `agent_harness`,
  `agent_trigger`, `channel_bots`, `image_generation`,
  `lexical_mention_extractor`, `memory`, `skills`, `task_dedup`.

## Checks

- `cargo test -p lexical_client` (`SQLX_OFFLINE` unset).

## Gotchas

- `LexicalClient::new` embeds `infra/local/certs/ca.pem` via `include_str!`
  and only trusts it when the URL is `localhost`/`127.0.0.1` over HTTPS —
  don't point this client at a real HTTPS host expecting that cert to help.
- The internal-access header name (`x-internal-auth-key`) must match what
  `lexical_service` expects; it's not read from `macro_auth`'s header
  constants.

## Related

- Rules: `.agents/rules/config-and-service-urls.md`
