# opensearch_client

## What it is

Part of the Search feature. Typed client for Macro's search index:
per-entity-type upsert/delete and search for documents, emails, channel
messages, chats, agent sessions, calendar events, call records, and
projects.

## Start here

- `src/lib.rs`: `OpensearchClient` construction (URL + basic auth).
- `src/upsert/<entity>.rs` + `src/delete/<entity>.rs`: one pair per indexed
  entity type — the shape each indexer must produce.
- `src/search/builder.rs` + `src/search/unified.rs`: the cross-entity search
  request builder and the unified result model.
- `src/chat_message_repair.rs`: paging the chats index's message documents
  by message id and deleting them by id, for the deleted chat message repair
  in `services/search_processing_service`.
- `examples/`: runnable usage beyond the README.

## Scope

- Owns: index document shapes, OpenSearch request/response mapping, and the
  unified search query across entity types.
- Not here: the generic query DSL used to build those requests →
  `opensearch_query_builder`; deciding what gets (re)indexed and when →
  `search_service`, `services/search_processing_service`.

## Boundaries

- Depends on: `opensearch_query_builder`, `models_opensearch`,
  `models_search_cursor`.
- Used by: `models_search`, `search_service`,
  `services/document_storage_service`, `services/search_processing_service`.

## Recipes

- Index a new entity type: add `src/<entity>.rs` (doc shape) →
  `src/upsert/<entity>.rs` + `src/delete/<entity>.rs` → a `src/search/<entity>.rs`
  query if it needs its own search endpoint → wire into
  `services/search_processing_service`.
- Property DATE filters use the existing nested `properties.date_value` epoch-millisecond projection; emit only supplied inclusive/exclusive bounds and use a negated nested exists query for missing dates.

## Checks

- `cargo test -p opensearch_client` (`SQLX_OFFLINE` unset; needs a running
  OpenSearch — see `crates/opensearch_query_builder/docker-compose.yml`).
- A change to the content or name search builders (`src/search`, or the
  `opensearch_query_builder` queries they use) merges only with
  `tests/content_search` passing. It seeds documents, chats and calls
  through the upsert paths, runs `search_unified`, and compares each search
  with the matches its rules select over `_analyze` tokens (`oracle.rs`; the
  cases and the rule each checks are in `fixtures.rs`). A new matching
  rule changes its oracle in the same change. It needs an OpenSearch whose
  search indices are empty, so plain `cargo test` skips it (`test = false`);
  CI runs it whenever this crate is selected. Locally, on a free port:
  `docker build -t search-opensearch infra/local/opensearch`, `docker run -d
  -p 127.0.0.1:<port>:9200 -e discovery.type=single-node search-opensearch`,
  then in `infra/stacks/opensearch/helpers` `bun install --frozen-lockfile`
  and `ENVIRONMENT=local DRY_RUN=false OPENSEARCH_URL=http://127.0.0.1:<port>
  OPENSEARCH_USERNAME=admin OPENSEARCH_PASSWORD=admin bun run
  scripts/create_indices.ts` (the node has no security plugin; the helper
  only needs the credentials set), and
  `SEARCH_TEST_OPENSEARCH_URL=http://127.0.0.1:<port> cargo test -p
  opensearch_client --test content_search`. A search the test keeps for a
  known bug is `#[ignore = "known bug: ..."]`; the fix removes the ignore.
  `tests/content_search/email_operators.rs` runs the same way and checks the
  conditions typed Mail search operators become (`EmailTextCondition`,
  `EmailLabelCondition`, excluded threads, sent bounds) and hyphenated words
  in email text inside the unified request; it needs the emails index empty
  too.

## Gotchas

- A top-level `range` on a date field fails the whole unified search
  (`unsupported_operation_exception` in the fetch phase) whenever the plain
  highlighter has a populated field to highlight, on OpenSearch 3.5 and
  whether the field is indexed or doc values only. A range inside a `nested`
  query (document date properties) is safe. Email sent bounds are therefore a
  script over the doc values (`emails::sent_between_query`).

- Map a failed `.send()` with `OpensearchClientError::request_failed` and a
  failed body read with `deserialization_failed`. Both take an
  `OpensearchOperation`: add a variant for a new request rather than passing a
  name. `request_failed` classifies the cause as a `TransportFailure` (timeout,
  connect, connection closed, other) and keeps the full source chain in
  `details`; reqwest's `Display` alone drops the cause. A body cut off by a
  transport failure also becomes `RequestFailed`, not `DeserializationFailed`.
- Workspace feature unification enables reqwest's HTTP/2, so every request
  from one process multiplexes over one connection, and a recycled connection
  fails them all at once. Wrap each public `OpensearchClient` method's request
  in `retry::resend_on_lost_connection`, which resends twice on a connection
  closed or refused before a complete response, never on a timeout or an
  error status. Every resent request must be safe to resend: a read, or a
  write by explicit id or by query. Starting a background task is not, so
  `start_email_link_delete` sends it once and, when the connection drops,
  looks for the task by its `X-Opaque-Id` instead.
- Put `instrument(err)` on the public method, not the inner function it
  retries, so a recovered attempt does not record an error span.
- Requests time out after five minutes (`REQUEST_TIMEOUT`). A delete that can
  run that long, such as a whole mailbox, starts a background task
  (`start_email_link_delete`) and reads its progress from `_tasks`
  (`email_delete_task`, a raw request because the typed tasks API is behind
  the `opensearch` crate's `experimental-apis` feature). The task's throttle
  applies to that task alone; callers bound how many run at once.
- A single-message email delete forces no refresh: it deletes the event
  thread's document by id, then delete-by-queries the message's copies under
  other threads with that thread left out, since the query sees only
  refreshed documents and would count the one just deleted as a conflict. A forced
  refresh per event refreshes every shard of the index, and a run of such
  events stalls their partition. A delete-by-query that only met conflicts
  deleted nothing and so forces no refresh either: refresh before failing on
  them, or the caller's retry meets the same stale documents.
- OpenSearch answers `_bulk` with 200 while failing items, for a full write
  queue (429) as for a mapping error. Classify every bulk answer item by item
  (`upsert::classify_bulk_response`): any failed item fails the call with
  `BulkItemsFailed`. `OpensearchClientError::refusal()` tells a caller to back
  off; it also reads the status and `error.type` from the body an `Unknown`
  error keeps.
- Agent-session writes never wait for a refresh. A search sees only refreshed
  documents, so delete what you know by id first and leave those ids out of
  the sweep's search, which finds the leftovers to delete by id. The parent's
  `indexed_messages` record (child id to content hash) and `pending_messages`
  (children being changed, not yet confirmed) are read with a real-time GET,
  so they are current without a refresh. Never trust a record
  without first naming the children you change as pending. Every agent-session
  write and delete carries `ReconcileAgentSessionArgs::version` as an
  `external_gte` version (a session delete carries its own lease's). A 409
  means the document holds a later version, not that the later reconcile
  finished: the request fails; a live event's retry runs under a new lease,
  and a backfill stops and is rerun. A delete creates a missing index even with `require_alias`, so
  the reconcile and the session delete first read the parent, which fails on a
  missing index or alias.
- Chat messages and call segments carry their own id in `entity_id` and no
  parent fields such as `channel_id`; only their join field names the
  parent. A delete or update of a chat or call reaches its children with
  `parent_id` (or `has_parent` on a parent field), never a term on the
  parent's `entity_id`. The ignored tests in `delete/chat/test.rs` and
  `delete/call_record/test.rs` check this on a scratch copy of the live
  `chats` and `call_records` mappings.
- The request-level `_source` filter does not reach `has_child` inner hits:
  each one returns the child's whole document unless its `InnerHits` names
  `source_fields`. Every join query names the fields its hit's `_source`
  struct decodes; do the same for a new one, or each child comes back with
  its full `content`.
- Fetch time and response size follow the number of inner hits returned,
  because the plain highlighter re-analyses each one. The content clauses
  of a document, chat, agent session or call share one budget per result
  (`INNER_HITS_PER_RESULT`, divided by `split_inner_hits_budget`), so a
  result carries at most that many matches, not every match; do not give
  each term its own.
- Build a `has_child` clause's per-term query with `query::child_content_query`
  and any other field's with `query::create_query`. A partial term that is
  one word (by the UAX #29 word boundaries the standard tokenizer uses) of
  three or more characters matches as `match_bool_prefix` of that word, not
  `match_phrase_prefix`: OpenSearch expands a phrase prefix again for every
  inner hit of every returned parent, and keeps only the first
  `max_expansions` terms of the shard, so words past them never match. Pass
  the word, not the term: `match_bool_prefix` reads a last token followed by
  punctuation (`con.`) as finished. A word counts as one only with nothing
  but ASCII punctuation around it and at most 255 characters (the
  tokenizer's longest token). Several words (`e-mail`, a Thai run the
  tokenizer keeps whole but UAX #29 splits), a word next to an emoji, and,
  outside content, words under three characters keep the capped
  `match_phrase_prefix`; OpenSearch has no phrase prefix that keeps every
  match.
- Email text terms go into one `simple_query_string`
  (`emails::build_text_query_string`), where a `term*` prefix is not
  analyzed: `follow-up*` looks for one token `follow-up`, which the index
  never holds. A partial term of several UAX #29 words is matched with
  `create_query` instead (`emails::text_terms_query`), so it follows the
  rules above, a Thai run included. A term of one word with punctuation
  around it (`follow-`, `Re:`, `-lunch`) matches by that word alone, as a
  prefix or, under three characters, as the whole word; one `single_word`
  does not count (a Devanagari word with a virama) is an uncapped `term*`
  too. A term with a symbol in it (`C♯`) stays whole, since the tokenizer
  keeps symbols. Everything a `simple_query_string` would read as syntax is
  escaped (`emails::escape_syntax`): unescaped, the address clause of
  `-lunch` was NOT `lunch` and matched every other message. Only regexp input
  keeps its punctuation.
- Document content has two matching shapes (`DocumentTermMatching`). `All`
  is one `has_child` per term: every term somewhere in the document, each a
  prefix. `Dynamic` is one `has_child` for queries of three or more terms:
  most non-stopword terms in the same chunk, only the last term a prefix.
  It both adds and removes matches (terms scattered over several chunks no
  longer match), so callers opt in per request.

## Related

- Docs: `README.md`, `examples/`
