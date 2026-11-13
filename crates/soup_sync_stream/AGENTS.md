# soup_sync_stream

## What it is

Server half of the streamed cache sync for Soup: runs a list of client-supplied
Soup or calendar GraphQL queries ("lanes") page by page, following each page's
cursor, and encodes every page as one NDJSON line. The wire format is the shared
contract in
[`docs/architecture/streamed-cache-sync.md`](../../docs/architecture/streamed-cache-sync.md);
the cache side decodes it independently, so change it only together with that
file.

## How it works

`SyncPlan::from_json` validates the body (lane ids, at most 32 lanes, query
operations only, a pageable `input`). `frames` / `ndjson_stream` run lanes in
order over a `PageExecutor`, one page per poll: the next page executes only when
the reader asks for the next line, and dropping the stream stops the loop.
Before each page the loop waits for the executor's `turn`; DSS backs it with
`PageTurns`, which shares a task's page slots among its open streams, the user
whose pages took the least time first.

## Start here

- `src/runner.rs`: the lane loop, paging rules, `maxItems` / `maxPages`, errors,
  and the `soup.sync_stream` span.
- `src/frame.rs`: the NDJSON frames.
- `src/turns.rs`: `PageTurns`, the page slots open streams take turns on.
- `src/request.rs`: request shape and validation.

## Boundaries

- Depends on: `async-graphql` (parser and `Request` only), no schema or database.
- Used by: `services/document_storage_service` (`src/api/graphql_soup/stream.rs`),
  which supplies auth, the per-user `ActiveStreams` guard, and the schema executor.

## Checks

- `cargo test -p soup_sync_stream`

## Gotchas

- `page.nextVariables` is `null` exactly when no further page of that lane follows
  in this stream (complete, `maxItems`, or failure); after `end maxPages` the last
  page's `nextVariables` is the resume point.
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
- Telemetry records counts, bytes, lane ids and server-chosen error text only,
  never query text, variables or response content.
- `frames` and `ndjson_stream` are fused: HTTP bodies can be polled again after
  they end (the gzip response layer's reader does), and a bare `unfold` panics
  on that poll, which truncates the compressed response.

## Related

- Rules: `.agents/rules/rust/code.md`, `.agents/rules/observability.md`
