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
  `Retry-After` when the task already runs its most streams
  (`MAX_STREAMS_PER_TASK`).
- Each page runs through the same schema and request context as
  `POST /soup/graphql` (auth, mail cache profile, replica reads), with three
  stream-only differences:
  - ID-only Soup lanes (`items` selects only `__typename` and `id`) page
    through one ordered list per lane per stream: the lane's first page fetches
    the whole list (in statements of up to 65,535 items; 500 when the email or
    CRM-contact leg is active, as those legs cap their pages) and each later
    page is the next slice, with the cursor a normal page would carry.
  - The email-content budget is a page's: up to 500 threads and 10,000
    requested messages per batch (one operation: 20 and 100).
  - A Soup page loads its email threads' Mail projections and metadata in one
    batch per page.
- A page runs for at most 45 seconds and fails its lane past that; a stream
  starts no page after 5 minutes and ends with `deadline`.
- The next page runs only when the response body is read, so a slow reader
  slows the server and nothing buffers without bound. A closed connection stops
  the loop.
- Traced as one `soup.sync_stream` span (lanes, pages, items, bytes, end
  reason) with a `soup.sync_stream.page` child per page (lane, page, items,
  outcome). No query text, variables or content in telemetry.

### Response

`200`, `content-type: application/x-ndjson`, one JSON object per line:

```
{"type":"page","lane":"tasks","page":0,"variables":{...},"response":{"data":{...}},"items":500,"nextVariables":{...}}
{"type":"laneDone","lane":"tasks","pages":12,"items":5800,"reason":"complete"}
{"type":"laneError","lane":"tasks","message":"..."}
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
