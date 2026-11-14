# search_service

## What it is

Part of the Search feature. OpenSearch-backed search API —
per-entity-type search plus a unified search across them — mounted into
`document_storage_service`, not run standalone.

## Start here

- `src/api.rs` + `src/api/search.rs`: the router; one file per entity type
  under `src/api/search/` (`document.rs`, `email.rs`, `chat.rs`, `channel.rs`,
  `calendar_event.rs`, `call_record.rs`, `crm_company.rs`, `project.rs`,
  `agent_session.rs`), plus `unified.rs` for cross-type search.
- `src/api/search/simple/`: a second, simpler request/response shape per type
  used by AI tools — kept in sync with the full one by hand.
- Name mode sources: chats (`simple/simple_chat.rs`) and channels
  (`simple/simple_channel.rs`) name-search in Postgres through `name_search`;
  every other type name-searches in OpenSearch. `simple_unified.rs` merges
  them and keeps one cursor slot per source.
- `src/api/context.rs`: `SearchHandlerState`, the shared handler state.
- `src/outbound.rs` + `src/outbound/agent_session.rs`: the OpenSearch query
  builders.

## Scope

- Owns: query construction against the `models_opensearch` index and the
  HTTP surface for searching each entity type.
- Not here: indexing/backfill (the writer side) or the service binary that
  hosts this router → `document_storage_service`.

## Boundaries

- Depends on: `opensearch_client`, `models_opensearch`, `macro_db_client`,
  `entity_access`, `properties`, `crm`, `item_filters`, `calendar_events`
  (domain only, no features, for its Macro call rule and label port).
- Used by: `document_storage_service` (mounts `search_router`); called
  through `search_service_client`.

## Recipes

- Add search for a new entity type: `src/api/search/<type>.rs` (handler) →
  `src/outbound.rs` (OpenSearch query) → `src/api/search.rs` (route) →
  `src/openapi.rs` → a matching `src/api/search/simple/simple_<type>.rs` if
  AI tools need it.
- Change the unified search ranking/shape: `src/api/search/unified.rs` and
  its `src/api/search/simple/simple_unified.rs` counterpart together.

## Checks

- `cargo test -p search_service` (`SQLX_OFFLINE` unset).
- `SQLX_OFFLINE=true cargo check` (`just check` recipe in `justfile`).

## Gotchas

- Search spans and logs never carry what the user typed: not the query, its
  terms, or the name term. Skip those arguments and record sizes and enums
  (`term_len`, `search.terms`, `search.search_on`). The unified
  search span is built by `simple_unified::unified_search_span`, which a test
  reads back; add a field there, not by instrumenting the request.
- A query is valid from one character (`terms::trimmed_query` rejects only a
  blank or quotes-only one). Short queries stay bounded in the query builders, not here: a
  term under three characters matches as a whole word in document, chat, call
  and email content, and name, channel, project and calendar prefixes stop at
  256 expansions. Measure a common one-letter word before loosening either.
- Every whitespace-split term is ANDed, so a term the standard tokenizer
  analyzes to nothing (`-`, `@`) matches no document and empties the search.
  `terms::drop_wordless_terms` removes such terms for exact and partial
  queries; run new term handling through it.
- The one exception to the AND is document content under
  `term_matching: dynamic` on the unified request (see `opensearch_client`'s
  `DocumentTermMatching`). It applies only when the request asks for it and
  the `enable-dynamic-search-term-matching` flag is on for the caller
  (`TermMatchingRollout`; local stacks have it on). The adapter never
  makes a search wait on the flag provider: a search gets the caller's
  remembered answer, or off when there is none, and an answer that is missing
  or older than five minutes is re-read in the background, once per caller,
  failed reads remembered as off. So in each process a caller's first search
  after the flag turns on still runs strict. The mode a first page ran is
  carried in the unified cursor (`document_term_matching`) and every later
  page runs it without reading the flag, because processes learn the flag
  independently and a page must not switch mode; a cursor without it decides
  per page. So the flag switches first pages: a search already under way,
  or a hand-made cursor on a request that asks for dynamic matching, keeps
  the cursor's mode. It is a rollout switch, not an access check. The SDK and AI tools
  never send it, so their documented AND holds. Names, emails, channels,
  chats and call records are always a strict AND.
- Calendar events have two scopes (`calendar_event_scope` on the unified
  request): `own` matches the caller's own and delegated calendars by
  owner and inbox link; `shared_with_you` resolves the events shared with the
  caller's channels in Postgres and searches by id, leaving out meetings the
  caller holds a live copy of, paired by `calendar_meeting_uid`. A snapshot
  counts there, since the `own` scope lists it, though it never counts as
  holding the meeting for the conference link. Enrichment re-checks every hit
  against the event's access rule. A caller who does not hold the meeting gets
  no conference link, and `calendar_events`' `content_without_macro_call` takes
  the Macro call out of the description; a provider's own join text in the body
  stays, as it does in a mention preview. Enrichment is the only gate: an id
  named in the `own` scope reaches a share as well. The index stores titles,
  never the description or location, so hits and highlights cannot carry the
  link.
- Agents answer calendar questions from search as often as from
  `occurrences()`, and the `own` scope matches by inbox link, so an event on a
  colleague's calendar comes back under the user's own address. Enrichment
  therefore labels each row with what an occurrence says (`calendarName`,
  `contributesToAvailability`, `inbox`, `role`) through `calendar_events`'
  `CalendarEventLabelReader`: one read per search, never per row, and a failed
  read leaves the labels off rather than failing the search, and missing labels
  mean unknown, never "not theirs". `organizer` stays the provider's raw value,
  which web rows show even where a read-only calendar names the user's own
  mailbox: `NameSearch`'s description is what tells a model that only `role`
  says they organize it. Fields alone did not stop models calling a colleague's
  event "your appointment"; `ai_tools` adds `calendar_events`'
  `off_schedule_summary` to such a result, and that sentence did. Measure a
  change to any of these with the default model on rows that are really in the
  index, and a user whose memory does not describe the behavior under test.

## Related

- Rules: `.agents/rules/rust/architecture.md`
