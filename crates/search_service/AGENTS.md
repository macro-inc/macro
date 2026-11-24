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
  (domain only, no features, for its Macro call rule and label port),
  `rate_limit` (its token bucket, for the API-key search allowance).
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
- A unified search (`/search`, `/search/simple`, on both DSS mounts) waits
  for its caller's turn in `domain::search_lanes` after the request's own
  checks (query, paging, cursor, terms, sessions, email filters; ids a source
  parses when it runs, such as channel and CRM company ids, are checked in the
  turn) and before it reads anything: per process, three searches in
  flight for the person's app session (the mention menu sends three one-type
  searches per term) and two for every other caller, the rest waiting in
  arrival order, and one still waiting after
  20 s answered 429 (`SearchError::Busy`, `Retry-After`). OpenSearch has few
  search threads per node, and one caller's burst of heavy searches filled
  them for everyone. The caller (`api::search::caller::search_caller`) is the
  user plus who acts: a signed agent (one lane across all its sessions for
  that user) or routine, else the credential's kind: the app session, a
  service searching for them (`Internal`: the AI tools, an agent's native
  search tools, routine drafting), or an API credential. So a person's app
  searches never wait behind a program's or a service's. The turn covers the
  CRM membership read (so a receipt is never older than its search) and the
  Postgres and OpenSearch search, not enrichment; the span records
  `search.lane`, `search.lane_wait_ms` and `search.lane_outcome`
  (`immediate`, `queued`, `refused`). Lanes are per process, so a caller's
  bound grows with the replica count; DSS builds one `SearchLanes` for both
  mounts. The internal mount runs under `connection_drop_prevention_handler`,
  so a service search whose caller gave up keeps its place in the service's
  lane and runs to the end.
- Before its turn, a unified search sent with a user API key
  (`CredentialOrigin::UserApiKey`, `search.caller = user_api_key`) draws on
  its account's search allowance (`domain::search_allowance`): one token
  bucket per account in Redis, shared by all its keys and every process, of
  200 searches that refills one a second. An empty bucket answers 429
  (`SearchError::RateLimited`, `Retry-After` in whole seconds) without
  waiting in the lane. The lanes bound searches in flight per process; the
  bucket bounds the rate across processes, which lanes cannot. It is a safety
  net, sized from production traces so today's busiest keys, which search in
  batches that a fixed 60-a-minute window would refuse, never reach it;
  measure before tightening it. A bucket that errors or does not answer
  within 500 ms lets the search run. A limited search is not logged as an
  error. The span records `search.rate_limit` (`allowed`, `limited`,
  `unavailable`), `search.rate_limit_remaining` (searches the account may
  still send at once) and `search.rate_limit_wait_ms`. App sessions,
  agents, routines, services, Macro API tokens and account-manager
  credentials never draw on it, and neither does `/search/channel`, which
  takes no lane turn either.
- Search never returns an item in the Trash. The documents and chats indexes
  keep trashed items until a purge (projects leave the index on trash).
  Enrichment drops a document, chat or project hit whose row has `deletedAt`,
  as it drops a hit whose row is gone, so the SDK, the API, the AI tools and
  the web app get the same results. The web mapper still checks
  `metadata.deleted_at`: saved AI chats render their stored search results
  through it, and older ones hold trashed hits. `/search/simple` returns hits
  unenriched and is not covered.
- A phrase is quoted with straight or curly double quotes
  (`terms::is_phrase_quote`), since phones and Macs type `“ ”` and `„ “` for
  `"`. The web app reads a query's quotes too, to gate empty searches and pick
  exact matching (`straightenQuotes`): change both together.
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

- Typed Mail search operators are read out of the query by the service, so
  Mail's search field, the API, the SDK and the AI tools search the same way
  (`api/search/email_operators.rs`, after `split_search_terms`): `subject:`,
  `from:`, `to:` (To, Cc and Bcc), `cc:`, `bcc:`, `in:<view>` (the last one
  wins; `in:focus` is the web app's and stays a word here), `in:<name>` and
  `label:` (a tag or inbox label of that name), `is:unread|read|starred|shared`,
  `has:attachment`, `after:`/`before:` (a day, from its midnight in the
  request's `time_zone`) and `newer_than:`/`older_than:` (`3d`, `2w`, `1m`,
  `1y` back on that zone's calendar), each with a minus to leave matches out.
  Each becomes an `EmailFilters` field ANDed with the request's own, applied
  before paging; an unknown name or invalid value stays a word. A search that
  types a named operator becomes an email search (no other kind can meet
  them); one that leaves email out, or uses `regexp`/`query` matching, reads
  none. A minus before a plain word or phrase says nothing about email, so it
  leaves out mail containing it only beside a named operator or in a search
  of email alone; otherwise, and always for a term starting `--`, it stays a
  word and the search keeps every kind. Opposite
  operators search nothing. A cursor keeps the first page's moment
  (`query_time_millis`) so relative dates bound the same instants on every
  page, and the response's `query_filters` reports what the operators became.
  `-in:signal` and `-in:noise` stay a word left out: each view is two
  conditions, so leaving it out is an OR across the index and Postgres.
- The typed conditions that are not thread states run in OpenSearch: text
  matches, labels and tags (`labels` terms or the nested tag filter, each name
  resolved for the caller in Postgres; a required name naming nothing matches
  nothing), favorites (the caller's favorite threads as required or excluded
  ids) and the sent range on `sent_at_millis`, which is stored for sorting
  only (doc values, not indexed), so the range is checked per candidate.
  `has:attachment` and the left-out views past `MAX_THREAD_SET_ALLOWLIST`
  are page checks: `ThreadStates::excluded` runs each as its own positive
  check and drops the threads it matches.
- Email search scopes by the owners of the inboxes the caller can reach
  (`fetch_search_inboxes_for_macro_id`), so a link's mail matches until its
  documents are deleted. An inbox whose disconnect has started (`deleting_at`)
  is excluded by `link_id` at once, because search-processing deletes its
  documents only after the email service purges its rows. Threads someone
  else shared from such an inbox are not excluded.
- Email filters mean what the Email list query means by them, applied before
  pagination (`domain/email_search.rs`). Shared threads are resolved from
  `entity_access` grants to the caller's sources, leaving out their own
  inboxes, and searched by id (at most `MAX_SHARED_THREADS`); `email_thread_ids`
  narrow by id. Calendar only and `view` (Sent, Drafts) are `ThreadSet`
  allowlists read from the partial index each view reads
  (`idx_email_threads_calendar_view`, `idx_email_threads_sent_view_link_ts_id`,
  `idx_email_messages_drafts_view`), at most `MAX_THREAD_SET_ALLOWLIST` per set,
  past which the set is checked per hit; two sets intersect. Read, done
  (`inbox_visible`), notification state and attachment kinds can each cover
  most of a mailbox or have no index, so `read_until_page_kept` checks each
  page's email threads in Postgres and reads further pages until the page is
  full, the results end, or `MAX_EMAIL_STATE_ROUNDS`; the span records the
  rounds and whether the bound was reached. Attachment kinds are read from
  `email_attachments`, as the list's built-in tabs filter them, not from the
  thread flags, which saved views read and which are not backfilled
  everywhere. `email_filters.view` is search only: expanding it into a list
  filter is an `ExpandErr`. `project_ids` (Drive folders) is an allowlist with
  the list's Project candidate rule (`entity_access::project_email_threads`):
  the caller's own threads in the folders, every thread in a folder granted to
  their sources whoever's inbox holds it, and thread shares in the folders,
  at most `MAX_PROJECT_THREADS`, from at most `MAX_EMAIL_PROJECTS` folders
  (more is a 400); the other thread-level filters are then checked per hit.
  Each folder's read stops once it has the cap's worth of threads the caller
  reads, so a granted folder is not read whole; a folder without a grant is
  read until then or to its end under the query's 5 s statement timeout.
  Thread shares are probed only for
  threads in folders the caller holds no grant on. `crm_domains` and `crm_addresses` are rejected with a 400
  (`UnsupportedEmailFilter`): they need the list's CRM team scope and consent.
  Enrichment reads a shared hit through its owner's inbox after `shared_among`
  confirms a grant on the thread or on its folder; a revoked grant drops it.

## Related

- Rules: `.agents/rules/rust/architecture.md`

- CRM search authorization uses the primary pool (`crm_db`) so member revocation cannot be reversed by replica lag; denied viewers receive no CRM matches or enrichment.
