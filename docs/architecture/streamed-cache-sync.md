# Streamed cache sync

The streamed cache sync fills the local cache database in the background, so
tasks, recent email, recent documents, channels and nearby calendar events can
be filtered, sorted and grouped locally. One streamed HTTP response carries every lane of a pass in priority order. The server owns the lanes: the
cache (the browser cache worker or the native cache plugin) names the pass and
sends its saved lane state, the server plans the stream's lanes from it and
declares each one before its pages, and cache-core decodes and writes them. So
lanes change with a server deploy, without an app release.

- Server: `crates/soup_sync_stream` (lane catalog, planning, lane loop,
  frames) mounted by
  `services/document_storage_service/src/api/graphql_soup/stream.rs`.
- Cache: `crates/client/cache-core/src/sync.rs` and the hosts that drive it.
- App: the passes, retries and pacing in
  `apps/web/src/lib/queries/soup/backfill.ts` and `apps/web/src/lib/queries/soup/sync/`.

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
  "protocol": 1,
  "pass": "first",
  "lanes": [
    { "id": "documents-recent", "resume": { "cursor": "…", "items": 500, "passStartedAt": "2026-11-02T11:00:00.000Z" } },
    { "id": "tasks", "watermark": "2026-11-01T09:00:00.000Z", "completedAt": "2026-11-01T09:02:13.000Z" }
  ],
  "calendar": {
    "timeZone": "Europe/Berlin",
    "coverage": [{ "kind": "timed", "start": 1793487600000, "end": 1796079600000 }]
  },
  "completedSince": "2026-11-02T11:00:00.000Z",
  "skipLanes": ["email-older"],
  "maxPages": 20
}
```

- `protocol`: the sync protocol the client's cache engine speaks
  (`cache_core::sync::SYNC_PROTOCOL`); see [Protocol versions](#protocol-versions).
- `pass`: `first` or `second` (see [Load order](#load-order)).
- `lanes`: the cache's saved state of every lane that has run against it,
  as the engine stores it: `resume`, the server's checkpoint from the last
  written page of an unfinished pass, sent back unread; `watermark`, when the
  last completed pass started (server time); `completedAt`, when it completed
  (the client's clock). Lanes the server no longer runs are ignored.
- `calendar` (optional, absent while the app reads calendars over REST): the
  app's IANA time zone, and every span the cache holds calendar occurrences
  for, merged per kind (`timed`: UTC milliseconds; `allDay`: local days since
  1970-01-01; both end-exclusive).
- `completedSince` (optional): leave out lanes that completed at or after this
  time (the `completedAt` clock); retries and second-pass streams send their
  pass's start.
- `skipLanes` (optional): Soup lanes to leave out of this stream.
- `maxPages` (optional): stop the stream after this many pages.

### Planning

The server plans a stream's lanes from the pass's lane catalog
(`crates/soup_sync_stream/src/catalog.rs`), in load order:

- A lane with a `resume` continues its pass from that cursor, counting its
  `maxItems` over the whole pass.
- A completed hydrate lane (`watermark` and `completedAt`) runs again with
  only what changed since its watermark.
- Membership lanes and lanes listed whole every run (`channels`,
  `email-shared`) start fresh; anything else does too.
- Calendar windows are the months the pass covers, nearest first, in the
  client's time zone, clamped to the range the server materializes, without
  what `calendar.coverage` holds. They take what the 32-lane cap leaves; the
  farthest are dropped first and come back next run. A window is fetched whole
  each stream. A time zone the server does not know plans no windows.

Pages run like this:

- `soup` paging: items are `data.user.soup.items`, the next cursor
  `data.user.soup.nextCursor`; the next page's input is
  `{ continuation: { cursor, expand, emailView, sortDirection } }`, with
  `expand`, `emailView` and `sortDirection` copied from the lane's first input.
- `calendar` paging: items are `data.user.calendarOccurrences.nodes`; the next
  cursor is `endCursor` while `hasNextPage`; the next page's input is the first
  one with `after: endCursor`. A repeated cursor fails the lane.

### Server rules

- 401 without an authenticated user; 426 when the body names no protocol or
  one the server does not speak, checked before the rest of the body; 400 for
  an invalid body (at most 256 saved lanes, 256 skipped lanes and 10,000
  coverage spans); 500 when a lane of the server's catalog does not build.
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
- Traced as one `soup.sync_stream` span (pass, saved and planned lanes, pages,
  items, bytes, time waited for turns, end reason) with a
  `soup.sync_stream.page` child per page
  (lane, page, time waited for its turn, items, outcome), under the request's
  span, which adopts the app's `traceparent`. The stream span also records the
  protocol it speaks. Counts are recorded as integers.
  No query text, variables or content in telemetry.

### Response

`200`, `content-type: application/x-ndjson`, one JSON object per line:

```
{"type":"lane","lane":"tasks","query":"query SoupBackfillSyncTasks(…) {…}","operationName":"SoupBackfillSyncTasks","paging":"soup","kind":{"kind":"hydrate"},"passStartedAt":"2026-11-02T12:00:00.000Z","coverage":{"entity":"task","scope":"all"}}
{"type":"page","lane":"tasks","page":0,"variables":{...},"response":{"data":{...}},"items":500,"resume":{...}}
{"type":"laneDone","lane":"tasks","pages":12,"items":5800,"reason":"complete"}
{"type":"laneError","lane":"tasks","message":"..."}
{"type":"waiting"}
{"type":"end","reason":"complete"}
```

- `lane`: a lane the stream runs, sent before anything else of it (a page, or
  the `laneError` of a lane whose first page failed); a lane the stream never
  reaches is not declared. It carries the query every page runs and its
  operation, the paging, what the cache does with the pages (`kind`:
  `hydrate`, `membership { scopes }` or `calendar { coverage }`), when its pass
  started, and the `coverage` the cache stores once it completes.
- `page.variables`: exactly what the server executed for the page.
- `page.response`: the GraphQL response `POST /soup/graphql` would return.
- `page.resume`: what the cache sends back as the lane's `resume` to continue
  after this page; `null` on lanes that never resume (membership, listed whole
  every run, calendar) and when no further page of the lane follows in this
  stream.
- `laneDone.reason`: `complete` (no next cursor) or `maxItems`.
- A page whose response has errors or lacks the paging fields is followed by
  `laneError` (a page that could not run, or timed out, sends only
  `laneError`). The failed lane sends no `laneDone`, and the stream carries on
  with the next lane.
- `waiting`: the stream's next page has not had its turn yet; it carries
  nothing to apply.
- `end.reason`: `complete` (every lane sent `laneDone` or `laneError`),
  `maxPages`, `deadline` (the stream ran for its longest time; lanes resume
  from their last page's `resume`), or `error` (a frame could not be
  encoded). A stream that closes without `end` was interrupted.

## Protocol versions

The protocol number names what the cache engine sends and how it reads the
lines it gets: the request, the line types, their fields and what their values
mean. The cache engine owns it, because it is the part that decodes the stream:
the web app ships it in its Wasm, the native apps in their binary, which
reaches users only through a store release. The server lists the versions it
speaks in `soup_sync_stream::PROTOCOL_VERSIONS` and serves each client exactly
the version it sent. Version 1 is the only one so far.

- Lanes are the server's: adding, removing or changing one needs no new
  version while it uses the existing kinds and paging. Keep a lane's id (the
  cache's saved state and members key on it). A changed lane's old `resume`
  checkpoints keep their cursor until that pass ends.
- A new line type that an older engine may skip needs no new version: engines
  skip line types they do not know (`SyncFrame::Unrecognized`), as they skip
  `waiting`. A new field on an existing line needs none either.
- Anything else is a new version: a request change, a new value for an
  existing field (an end or `laneDone` reason), a line an older engine must
  not skip, or a change in what a line means. Unknown values of known fields
  fail the stream.
- Raise the server's upper end, and deploy it, before any engine sends the new
  version. Raise its lower end only once no supported client sends the old
  one; until then the server keeps serving it.
- A client the server refuses (426) cannot stream through it and runs the paged
  backfill for the rest of the session, as on a host that cannot stream.
- The run arguments (`SyncStartArgs`) cross a release boundary too: an
  over-the-air web bundle passes them to the native engine of an older store
  build. Add only optional fields that older engines may ignore.

## Cache behaviour

A run is started with its arguments (`SyncStartArgs`: the pass and the
request's other fields; types in
`apps/web/src/lib/graphql-cache/sync-protocol.ts`, mirrored in
`cache_core::sync` with serde camelCase). `Engine::sync_begin` builds the
request from them, every lane's saved state and, for calendars, the cache's
coverage. The host sends it, then feeds the response bytes to cache-core,
which decodes lines and applies frames in order; a `lane` line adds its lane
to the run (a frame of a lane the stream has not declared breaks it). While the cache writes, the host keeps reading the
body into a bounded read-ahead buffer (16 MiB of received but unapplied bytes,
plus one chunk), so the server computes later pages during writes; when the
buffer is full the host stops reading and the server waits. Every exit (end,
error, stall, stop, park, suspend) closes the connection; saved state only
reflects applied pages.

A host gives a connection up as `stalled` when the response, or the next bytes
of its body, take longer than 90 s (`SYNC_STALL_MS`, the native plugin's
`STALL_TIMEOUT`): a network path that went silent never fails by itself. Only
time spent reading counts, not time the host waits with a full buffer. A
healthy stream is silent for at most a page's 45 s plus one `waiting` interval,
so keep the limit above the server's `PAGE_TIMEOUT` + `WAITING_INTERVAL`.

Lane kinds:

- `hydrate`: each page is written with `Engine::sync_write_page`: normalized
  records merged with what is cached, the hosts' Soup projections, and the lane
  state in one storage transaction. It skips what only foreground writes need
  (response projection, field changes, dependency fan-out, new hot-tier
  entries); an identity change or pending optimistic layers fall back to the
  general hydration write. Every item's record key is recorded as a member of
  the lane. Lane state saves `resume`, page and item counts and
  `passStartedAt` with each page; a lane declared with another
  `passStartedAt` starts counting a new pass. On `laneDone` the lane is marked
  complete: `completedAt = now`, `watermark = passStartedAt`,
  `coverage = lane.coverage`, `resume = null`.
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
  `sync_members`, storage schema 13) and are wiped with it.
- One run at a time per database; a second start returns `busy`.
- A run stops on `syncStop`, when the browser engine parks or is disposed, or
  when the native app is suspended. Progress up to the last written page is
  kept; the next run resumes from `resume`.
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
pins the selection, and `soup_sync_stream`'s catalog test checks the lanes
select it. The selections live in the server's lane queries
(`crates/soup_sync_stream/src/catalog/minimal_*.graphql`, `channels.graphql`).
Every lane query is generated from its operation and the app's own fragments
(`apps/web/scripts/generate-sync-lane-queries.ts`), so a field the app adds
to a fragment a lane spreads reaches synced records once the queries are
regenerated, which a web test enforces. The minimal lanes select their fields
inline, so a field the app starts filtering on needs adding to their
operations in `crates/soup_sync_stream/src/catalog/operations/`. A
channel row carries what the channel list renders plus what the filter index
needs. Property definitions are not sent with
every item.

## Load order

The server's catalog (`crates/soup_sync_stream/src/catalog.rs`) holds each
pass's lanes in this order; the app runs the passes and paces their streams.

First pass (one stream, no `maxPages`): `channels`, `tasks`,
`task-projects`, `email-recent` (60 days, no bodies), `email-shared`,
`documents-recent` (1,000 most recently viewed or updated), `calendar-near-*`
(2 months each way), then the membership lanes `tasks-ids`,
`task-projects-ids`, `channels-ids`, `documents-ids` and `email-shared-ids`.

Second pass (repeated streams, each resuming from saved state, 2 s apart):
`crm-contacts`, `core-rest`, `documents-rest`, `calendar-far-*` (12 months
each way), `email-older` (back to 1 year, at most 10,000 threads), then full
details for tasks and documents and email message pages
(`email-content`). The first stream asks for 20 pages; each later one for as
many as the previous stream's rate says fit 15 s and 32 MiB (10 to 2,000
pages), and a stream still running after 30 s is stopped, keeping its written
pages (`SECOND_PASS_STREAM` in `apps/web/src/lib/queries/soup/sync/host.ts`).

A completed lane runs again on later passes with "changed since its
watermark"; membership lanes, channels and shared email run in full every
time. Channel messages and threads, and calls, are not synced. Contacts are
not a lane: the app's contact directory backfill (`queries/contacts`) keeps
them, beside the sync.

## App

`useSoupBackfills` (`apps/web/src/lib/queries/soup/backfill.ts`) runs the
streamed sync in the leader tab when the remote flag
`enable-streamed-cache-sync` is on and the cache host can stream
(`isSyncHost`). Otherwise, when a host answers `unsupported` (a native build
older than the sync commands answers `Command … not found`), and when the
server refuses the cache engine's protocol (426), the paged backfill runs as
before. A lane that fails is re-run in the same pass after
2 s, then 4 s; after three failures it is left out of the pass and resumes on
the next one. A first-pass stream the server ended early (`deadline`) is
resumed until the pass completes, and only then does the second pass start.
A stream that fails is retried five times with backoff; a busy server (409,
429 or 503) is instead asked again every 30 s for as long as it stays busy,
without spending those retries.

A sync whose stream used up its retries stops and waits
(`sync/resume.ts`), then runs again from the state saved in the cache, as
often as it takes: when the device comes back online, when the app returns to
the foreground, or after a pause of 1 minute, doubled per stop in a row up to
5 minutes and spread by a fifth either way. The pause covers a server that was
unreachable while the device stayed online, which raises no event. This holds
for every failure, a run its host stopped included (`aborted`: a parked
browser engine, a suspended native app). Only `unsupported` ends the streamed
sync.

### Telemetry

`apps/web/src/lib/queries/soup/sync/telemetry.ts` traces the sync.

- Each stream the app opens is a `graphql_cache.sync.stream` client span:
  pass, stream number within the pass, outcome (`complete`, `maxPages`, or
  the failure kind, with `http.response.status_code` for an HTTP failure),
  duration, bytes, lanes, pages, items, cache write time and failed lanes. Its
  trace context travels in the run's request headers, on the browser worker
  and the native plugin alike, so one trace runs from the app's stream to the
  server's `soup.sync_stream` and each page's `graphql.execute`.
- Each pass is a `graphql_cache.sync.pass` span recorded when the pass ends,
  from its first stream to its outcome: `complete`, `interrupted` (the app
  stopped it: another tab took over, or the user, flag or cache changed) or
  the failure it gave up on (`stalled` for a connection that went silent). A
  run that follows a stop carries `cache.sync_resumes`, the stops before it,
  and `cache.sync_resumed_by` (`online`, `foreground` or `timer`). It carries
  the pass's streams, busy answers
  (409, 429, 503), failed streams, bytes, pages, items, write time and failed
  lanes. A tab closed mid-pass records no pass span; its stream spans remain.
- `cache.sync_session` is the same on every span of one sync run and links a
  pass to its streams and the first pass to the second.
- Attributes are counts, durations and fixed classes; lane errors and failure
  messages are not recorded.
- A failure to record never fails the sync: the stream runs untraced.
