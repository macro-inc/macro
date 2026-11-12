# Streamed cache sync

The streamed cache sync fills the local cache database in the background, so
tasks, recent email, recent documents, contacts, channels and nearby calendar
events can be filtered, sorted and grouped locally. One streamed HTTP response
carries every lane of a pass in priority order; the cache (the browser cache
worker or the native cache plugin) opens the connection, and cache-core decodes
and writes it.

- Server: `crates/soup_sync_stream` (lane loop, frames) mounted by
  `services/document_storage_service/src/api/graphql_soup/stream.rs`.
- Cache: `crates/client/cache-core/src/sync.rs` and the hosts that drive it.
- App: the plan, lanes and pacing in `apps/web/src/lib/queries/soup/sync/`.

## HTTP stream

`POST {dssHost}/items/soup/graphql/stream` (service route
`/soup/graphql/stream` on `document_storage_service`).

Request headers: `content-type: application/json`,
`accept: application/x-ndjson`, `x-macro-mail-cache-profile: <profile>`, the
caller's auth (cookies or `authorization: Bearer`). Native hosts also send
`accept-encoding: gzip`.

Request body:

```json
{
  "lanes": [
    {
      "id": "tasks",
      "query": "query SoupBackfillSyncTasks($input: SoupInput!) { user { id soup(input: $input) { items { ... } nextCursor } } }",
      "operationName": "SoupBackfillSyncTasks",
      "variables": { "input": { "initial": { "limit": 500 } } },
      "paging": "soup",
      "maxItems": 1000
    }
  ],
  "maxPages": 20
}
```

- `id`: `[a-z0-9-]{1,64}`, unique within the request.
- `query`: server-safe GraphQL text (client-only directives removed); `query`
  operations only.
- `variables`: what the lane's first page runs (an initial input, or a saved
  resume point).
- `paging`:
  - `soup`: items are `data.user.soup.items`, the next cursor
    `data.user.soup.nextCursor`; next variables are
    `{ ...variables, input: { continuation: { cursor, expand, emailView, sortDirection } } }`,
    with `expand`, `emailView` and `sortDirection` copied from the lane's first
    input.
  - `calendar`: items are `data.user.calendarOccurrences.nodes`; the next
    cursor is `endCursor` while `hasNextPage`; next variables are
    `{ ...variables, input: { ...variables.input, after: endCursor } }`. A
    repeated cursor fails the lane.
- `maxItems` (optional): stop the lane once at least this many items were sent.
- `maxPages` (optional): stop the stream after this many pages.

### Server rules

- 401 without an authenticated user; 400 for an invalid body or a non-query
  operation; at most 32 lanes.
- 409 when the user already has a stream open on this server task; 503 with
  `Retry-After` when the task already holds its most open streams
  (`MAX_STREAMS_PER_TASK`).
- Open streams take turns. A task runs at most `PAGE_SLOTS` pages at once,
  whatever the number of open streams, and a freed slot goes to the waiting
  stream whose user's pages took the least time in the last 5 minutes (summed
  across that user's streams). Every user gets the same share of the slots'
  time, so a small sync, and the first pages of any sync, finish ahead of a
  long one. A stream that waits for its turn sends `waiting` every 10 seconds.
- Each page runs through the same schema and request context as
  `POST /soup/graphql` (auth, mail cache profile, replica reads), with three
  stream-only differences:
  - A timestamp-sorted Soup lane is fetched many pages per statement, and
    each page is the next slice of what was fetched, with the cursor a normal
    page would carry: a statement finds which of the user's items match once,
    not once per page. A statement fetches up to 65,535 items for an ID-only
    lane (`items` selects only `__typename` and `id`) and 5,000 for any other
    (500 when the email or CRM-contact leg is active, as those legs cap their
    pages). Items with fields are served for at most 30 seconds after their
    statement ran; past that the lane is read again from the page's cursor,
    half as many items at once. A page that selects `frecencyScore` runs like
    any other.
  - The email-content budget is a page's: up to 500 threads and 10,000
    requested messages per batch (one operation: 20 and 100).
  - A Soup page loads its per-entity data in one batch per page instead of as
    each entity's fields ask: its entities' viewer permissions and properties,
    and its email threads' Mail projections and metadata.
- A page runs for at most 45 seconds and fails its lane past that; time spent
  waiting for a turn does not count. A stream starts no page after 5 minutes,
  waiting included, and ends with `deadline`.
- The next page runs only when the response body is read, so a slow reader
  slows the server and nothing buffers without bound. A closed connection stops
  the loop.
- Traced as one `soup.sync_stream` span (lanes, pages, items, bytes, time
  waited for turns, end reason) with a `soup.sync_stream.page` child per page
  (lane, page, time waited for its turn, items, outcome), under the request's
  span, which adopts the app's `traceparent`. Counts are recorded as integers.
  No query text, variables or content in telemetry.

### Response

`200`, `content-type: application/x-ndjson`, one JSON object per line:

```
{"type":"page","lane":"tasks","page":0,"variables":{...},"response":{"data":{...}},"items":500,"nextVariables":{...}}
{"type":"laneDone","lane":"tasks","pages":12,"items":5800,"reason":"complete"}
{"type":"laneError","lane":"tasks","message":"..."}
{"type":"waiting"}
{"type":"end","reason":"complete"}
```

- `page.variables`: exactly what the server executed for the page.
- `page.response`: the GraphQL response `POST /soup/graphql` would return.
- `page.nextVariables`: what the lane runs next; `null` when no further page of
  the lane follows in this stream.
- `laneDone.reason`: `complete` (no next cursor) or `maxItems`.
- A page whose response has errors or lacks the paging fields is followed by
  `laneError` (a page that could not run, or timed out, sends only
  `laneError`). The failed lane sends no `laneDone`, and the stream carries on
  with the next lane.
- `waiting`: the stream's next page has not had its turn yet; it carries
  nothing to apply.
- `end.reason`: `complete` (every lane sent `laneDone` or `laneError`),
  `maxPages`, `deadline` (the stream ran for its longest time; lanes resume
  from their last page's `nextVariables`), or `error` (a frame could not be
  encoded). A stream that closes without `end` was interrupted.

## Cache behaviour

A run is started with a plan (`SyncStartArgs`, types in
`apps/web/src/lib/graphql-cache/sync-protocol.ts`, mirrored in
`cache_core::sync` with serde camelCase). The host sends the request built from
the plan, then feeds the response bytes to cache-core, which decodes lines and
applies frames in order. While the cache writes, the host keeps reading the
body into a bounded read-ahead buffer (16 MiB of received but unapplied bytes,
plus one chunk), so the server computes later pages during writes; when the
buffer is full the host stops reading and the server waits. Every exit (end,
error, stop, park, suspend) closes the connection; saved state only reflects
applied pages.

Lane kinds:

- `hydrate`: each page is written with `Engine::sync_write_page`: normalized
  records merged with what is cached, the hosts' Soup projections, and the lane
  state in one storage transaction. It skips what only foreground writes need
  (response projection, field changes, dependency fan-out, new hot-tier
  entries); an identity change or pending optimistic layers fall back to the
  general hydration write. Every item's record key is recorded as a member of
  the lane. Lane state saves `nextVariables`, page and item counts and
  `passStartedAt` with each page. On `laneDone` the lane is marked complete:
  `completedAt = now`, `watermark = passStartedAt`, `coverage = plan.coverage`,
  `nextVariables = null`.
- `membership { scopes }`: pages are not written; their item keys are
  collected in memory. On `laneDone` with reason `complete`, every key recorded
  as a member of a lane in `scopes` but absent from the collected set is
  deleted as a server cache deletion and removed from those lanes' members.
  Membership lanes always start fresh, never save a resume point, and take no
  `maxItems`.
- `calendar { coverage }`: pages are written like `hydrate` (no members); the
  lowest watermark per `linkId` across pages is kept. On `laneDone` the window
  is committed with the existing calendar commit.

Rules:

- Each page is one engine write at background priority (the browser worker's
  hydration priority), so reads for open views go first.
- Lane state and members live in the cache database (`sync_lanes`,
  `sync_members`, storage schema 12) and are wiped with it.
- One run at a time per database; a second start returns `busy`.
- A run stops on `syncStop`, when the browser engine parks or is disposed, or
  when the native app is suspended. Progress up to the last written page is
  kept; the next run resumes from `nextVariables`.
- A failed lane fails alone: a page the cache cannot write writes nothing and
  fails its lane, which keeps the saved state of its last written page while
  the other lanes carry on. The run result reports it as the lane summary's
  `error`. A frame for the lane after that, a second `laneError`, or
  `end: error` breaks the stream and fails the run.

## Minimal fields

The first pass selects minimal rows: what a row renders plus every field lists
filter, sort or group by. Rows must stay complete for the local filter index
(`crates/soup_filter_cache_adapter`): a document-kind record is indexed only
when it has `cacheProjection`, `ownerId`, `fileType`, `projectId`,
`createdAt`, `updatedAt`, `subType`, `properties`, `notifications` and
`isFavorited`. Without one of them, rows are written but silently stay out of
local filtering; `soup_filter_cache_adapter/src/test/sync_minimal_fields.rs`
pins the selection. The selections live in
`apps/web/src/lib/queries/soup/sync/minimal.ts`. A channel row carries what
the channel list renders plus what the filter index needs; a contact row is
`__typename id`. Property definitions are not sent with every item.

## Load order

First pass (one stream, no `maxPages`): `contacts`, `channels`, `tasks`,
`task-projects`, `email-recent` (60 days, no bodies), `email-shared`,
`documents-recent` (1,000 most recently viewed or updated), `calendar-near-*`
(2 months each way), then the membership lanes `tasks-ids`,
`task-projects-ids`, `contacts-ids`, `channels-ids`, `documents-ids` and
`email-shared-ids`.

Second pass (repeated streams, each resuming from saved state, 2 s apart):
`crm-contacts`, `core-rest`, `documents-rest`, `calendar-far-*` (12 months
each way), `email-older` (back to 1 year, at most 10,000 threads), then full
details for tasks and documents and email message pages
(`email-content`). The first stream asks for 20 pages; each later one for as
many as the previous stream's rate says fit 15 s and 32 MiB (10 to 2,000
pages), and a stream still running after 30 s is stopped, keeping its written
pages (`SECOND_PASS_STREAM` in `apps/web/src/lib/queries/soup/sync/host.ts`).

A completed lane runs again on later passes with "changed since its
watermark"; membership lanes run in full every time. Channel messages and
threads, and calls, are not synced.

## App

`useSoupBackfills` (`apps/web/src/lib/queries/soup/backfill.ts`) runs the
streamed sync in the leader tab when the remote flag
`enable-streamed-cache-sync` is on and the cache host can stream
(`isSyncHost`). Otherwise, and when a host answers `unsupported` (a native
build older than the sync commands answers `Command … not found`), the paged
backfill runs as before. A lane that fails is re-run in the same pass after
2 s, then 4 s; after three failures it is left out of the pass and resumes on
the next one. A first-pass stream the server ended early (`deadline`) is
resumed until the pass completes, and only then does the second pass start.
A stream that fails is retried five times with backoff; a busy server (409,
429 or 503) is instead asked again every 30 s for as long as it stays busy,
without spending those retries.

### Telemetry

`apps/web/src/lib/queries/soup/sync/telemetry.ts` traces the sync.

- Each stream the app opens is a `graphql_cache.sync.stream` client span:
  pass, stream number within the pass, outcome (`complete`, `maxPages`, or
  the failure kind, with `http.response.status_code` for an HTTP failure),
  duration, bytes, lanes, pages, items, cache write time and failed lanes. Its
  trace context travels in the plan's request headers, on the browser worker
  and the native plugin alike, so one trace runs from the app's stream to the
  server's `soup.sync_stream` and each page's `graphql.execute`.
- Each pass is a `graphql_cache.sync.pass` span recorded when the pass ends,
  from its first stream to its outcome: `complete`, `interrupted` (the app
  stopped it: another tab took over, or the user, flag or cache changed) or
  the failure it gave up on. It carries the pass's streams, busy answers
  (409, 429, 503), failed streams, bytes, pages, items, write time and failed
  lanes. A tab closed mid-pass records no pass span; its stream spans remain.
- `cache.sync_session` is the same on every span of one sync run and links a
  pass to its streams and the first pass to the second.
- Attributes are counts, durations and fixed classes; lane errors and failure
  messages are not recorded.
