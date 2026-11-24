# soup_sync_stream

## What it is

Server half of the streamed cache sync for Soup: owns each pass's lanes (the
Soup and calendar GraphQL queries the cache is filled from), plans a stream's
lanes from the client's saved lane state, runs them page by page, following
each page's cursor, and encodes every page as one NDJSON line. The wire format
is the shared contract in
[`docs/architecture/streamed-cache-sync.md`](../../docs/architecture/streamed-cache-sync.md);
the cache side decodes it independently, so change it only together with that
file.

## How it works

`SyncPlan::from_json` reads the body's `protocol` first, against
`PROTOCOL_VERSIONS` (`RequestError::UnsupportedProtocol`, which DSS answers
with 426), then the pass and the saved lane state, and plans the lanes
(`plan.rs`): an unfinished pass resumes from its `resume` checkpoint, a
completed lane catches up from its watermark, membership and restart-on-run
lanes start fresh, and calendar windows fill what the 32-lane cap leaves.
`frames` / `ndjson_stream` run lanes in order over a `PageExecutor`, one page
per poll, each lane's `lane` line first: the next page executes only when the
reader asks for the next line, and dropping the stream stops the loop.
Before each page the loop waits for the executor's `turn`; DSS backs it with
`PageTurns`, which shares a task's page slots among its open streams, the user
whose pages took the least time first.

## Start here

- `src/catalog.rs`: each pass's lanes in load order, the operation each runs
  (`LANE_QUERIES`) and their first inputs. The documents are the client's,
  sent with each request (`queries`).
- `src/plan.rs`: a stream's lanes from the saved lane state; `src/calendar.rs`
  the calendar windows, in the client's time zone, around its coverage.
- `src/runner.rs`: the lane loop, paging rules, `maxItems` / `maxPages`, errors,
  and the `soup.sync_stream` span.
- `src/frame.rs`: the NDJSON frames.
- `src/turns.rs`: `PageTurns`, the page slots open streams take turns on.
- `src/request.rs`: request shape and validation.

## Boundaries

- Depends on: `async-graphql` (parser and `Request` only), `chrono` and
  `chrono-tz` (calendar months in the client's zone); no schema or database.
  Tests validate the catalog with `apollo-compiler` against
  `static_assets/schema.graphql`.
- Used by: `services/document_storage_service` (`src/api/graphql_soup/stream.rs`),
  which supplies auth, the per-user `ActiveStreams` guard, and the schema executor.

## Recipes

- Change what a lane selects: it is the app's document. Edit the operation in
  the app's GraphQL documents
  (`apps/web/src/lib/service-clients/service-storage/graphql/`;
  `sync-lanes.graphql` holds the operations only the sync runs), and refresh
  the fixture the catalog tests plan with:
  `UPDATE_SYNC_LANE_QUERIES=1 bunx vitest run src/lib/queries/soup/sync/lane-queries.test.ts`
  in `apps/web`, which writes `src/catalog/test/client_queries.json`.
- Add a lane operation: add it to the app's documents and to
  `LANE_DOCUMENTS` in `apps/web/src/lib/queries/soup/sync/lane-queries.ts`,
  then to `LANE_QUERIES` here. Older clients do not send it, and the server
  leaves their lane out.
- Change a lane: `src/catalog.rs`, then
  `src/catalog/test/expected_lanes.json`. The catalog test validates every
  lane's document (from the fixture) and variables against
  `static_assets/schema.graphql`. Keep a
  lane's id (the cache's saved state and members key on it) and its query's
  operation name: the cache, in native apps already shipped too, chooses what
  it requires of a page by that name. Each `LaneQuery` in `LANE_QUERIES`
  declares those requirements, and `soup_filter_cache_adapter`'s
  `sync_lane_requirements` test compares them with the cache's own
  `backfill_requirements`.

## Checks

- `cargo test -p soup_sync_stream`
- `bunx vitest run src/lib/queries/soup/sync/lane-queries.test.ts` in
  `apps/web`: the fixture matches what the app sends.

## Gotchas

- The cache engine (`cache_core::sync::SYNC_PROTOCOL`) sends one protocol
  number and gets exactly that version. A line type an older engine may skip
  needs no new version; any other wire change does, and `PROTOCOL_VERSIONS`
  must cover it in a deployed server before an engine sends it. Native apps
  keep old engines for months, so lower its start only once none are left.
- `page.resume` is the client's checkpoint, which it sends back unread: `null`
  on lanes that never resume (membership, restart-on-run, calendar) and when
  no further page of the lane follows in this stream (complete, `maxItems`, or
  failure); after `end maxPages` the last page's `resume` is where the next
  stream continues. A lane's query change keeps old checkpoints running the
  old cursor until the pass ends.
- A failing lane sends `laneError` (no `laneDone`) and the next lane runs; `end`
  is `error` only when the stream itself fails (a frame does not encode).
- A page runs for at most `PAGE_TIMEOUT` (45 s, under the load balancer's 60 s
  idle timeout) and fails its lane past it; a stream starts no page after
  `STREAM_DEADLINE` (5 minutes) and ends `deadline`, so one connection does
  not stay open for long. DSS also caps open streams per task (`stream.rs`).
  The cache hosts give up a connection that is silent for 90 s
  (`SYNC_STALL_MS`, `STALL_TIMEOUT`), so `PAGE_TIMEOUT` plus
  `WAITING_INTERVAL` must stay well under that.
- A page's turn is held only while the page executes, never while the reader
  takes the line, so a slow reader holds no slot. A stream waiting for its
  turn sends `waiting` every `WAITING_INTERVAL`; the loop drops that wait and
  asks again, which is safe because a place in line depends on the user's
  page time, not on when the stream asked.
- Soup lanes are cheap because of the service, not this crate: DSS puts a
  `graphql_soup::SoupLaneLists` in every page's request data, and the Soup
  resolver fetches a lane many pages per statement and serves its pages as
  slices.
- Calendar months and dates are the client's (`calendar.timeZone`); a zone
  this server does not know plans no calendar windows rather than failing the
  stream.
- Telemetry records counts, bytes, lane ids and server-chosen error text only,
  never query text, variables or response content.
- `frames` and `ndjson_stream` are fused: HTTP bodies can be polled again after
  they end (the gzip response layer's reader does), and a bare `unfold` panics
  on that poll, which truncates the compressed response.

## Related

- Rules: `.agents/rules/rust/code.md`, `.agents/rules/observability.md`
