# Database profiling

Run the isolated stack with browser telemetry enabled, following
[Running locally](../../../../docs/RUNNING_LOCALLY.md). Keep the instance running
throughout the audit; `run_local` startup and its quit command rebuild/remove
instance data. Use the `r` hotkey to rebuild services without replacing data.

```sh
nix develop --command just run_local --no-doppler --instance database-profiling-audit --port-base 21000
```

Use a private Playwright browser to sign in and save its `storageState` outside
the repository. That file contains credentials: do not commit it or attach it to
a PR. Create dedicated synthetic databases through the app's supported APIs.
Keep existing fixtures. Test 1k, 5k, 10k, 25k, 50k and 100k **stored** rows, with
both unfiltered and selective views. Record columns, types, relationships,
filters, build SHA and browser version alongside each run.

From `apps/web`, measure without changing data:

```sh
bun scripts/database-profile/measure.mjs \
  --url https://localhost:21009/app/database/UUID \
  --state /tmp/database-profile-auth.json \
  --table Records --rows 1000 --entries 1000 \
  --output /tmp/database-profile-1000 --repeats 3 \
  --chrome /path/to/google-chrome
```

Use the actual proxy URL printed by `run_local`. The harness accepts loopback
URLs only, opens its own browser, and refuses to overwrite an output directory.
Each repetition starts with a fresh context containing only the saved login
state, then measures a warm reload in that same context. `--rows` is the number
of saved rows expected in the selected view; the blank insertion row is excluded.
`--entries` is the fixture's total stored row count. The engine currently caps
reads at 20,000 rows, so a 100k database does **not** imply 100k rendered rows.
Confirm the trace's `database_sql.truncated` attribute when interpreting results.

The JSON results include first complete grid and subsequent frame opportunity,
long tasks, CDP script/layout/task counters, heap size, HTTP timing/bytes, and
traceparents. The frame measurement is a two-frame rendering opportunity, not
an assertion that the browser painted. The 100ms row polling adds up to 100ms
measurement uncertainty; use the internal spans to attribute work precisely.
Requests completing within 1.5 seconds after that frame are included to expose
background refreshes; this is not a measurement of network quiescence.

Run `--profile` separately to save Chrome CPU profiles. Compare ordinary runs
first: profiling adds overhead. Use at least three repetitions and report
medians and ranges, not the fastest run. Vite measurements include development
overhead; repeat production-bundle measurements before claiming production
latency. Exported profiles may contain application source URLs and fixture IDs.

## Trace boundaries

| Span | What it measures |
| --- | --- |
| `database_sql.query` | Catalog through publishing, with reason, policy, target, row count, truncation and outcome |
| `database_sql.catalog` | WASM load if necessary and catalog construction |
| `database_sql.engine.open` / `.start` | Engine opening/compilation and initial planning |
| `database_sql.fetch` / `.fold` | Each existing 500-row source request and the engine consuming its answer |
| `database_sql.rows.decode` | GraphQL property values converted into engine cells, once per page |
| `database_sql.compare` | Equality comparison of the new catalog/result with the prior answer |
| `database_sql.publish` | Signal updates and synchronous downstream reactive work |
| `database_sql.frame` | Time after a changed result is published until a rendering opportunity; cancelled/hidden/timeout outcomes are not ready frames |
| `soup.pool.acquire` | Connection acquisition, with pool size and idle count at entry |
| `soup.sql.fetch_decode` | Query construction, SQL round trip, row decoding and flat-row conversion, excluding connection acquisition |
| `soup.rows.convert` | Grouped-row conversion after the SQL read |
| `graphql.serialize` | GraphQL response serialization and response construction, with uncompressed response bytes |

`graphql.execute` includes serialization. HTTP transfer, compression and proxy
time are outside `graphql.serialize`. Fetch/decode is not server-only SQL time:
use PostgreSQL execution plans, `pg_stat_statements`, and lock/I/O diagnostics
to separate server execution from transfer and client decoding. Cache worker
spans already measure cache reads, locks and queueing. No per-cell spans or
per-row conversion spans are emitted by these additions.

New local stacks preload `pg_stat_statements` (the existing migration installs
the extension). Verify `SHOW shared_preload_libraries`, then take snapshots of
`pg_stat_statements` before and after each measured workload, restricted to the
current database’s `dbid` from `pg_database`. Compare deltas in
`calls`, `total_exec_time`, `rows`, `shared_blks_hit` and `shared_blks_read` by
`dbid`, `userid`, `queryid` and `toplevel`; do not reset shared statistics. Statistics span all requests to this
database, so correlate the measured window and query shape with the trace.
Use `EXPLAIN (ANALYZE, BUFFERS)` only for the audit's read queries on synthetic
fixtures. Existing running stacks need a PostgreSQL restart to activate preload;
do not restart another session's stack or rerun `run_local` over retained data.

Use a request's traceparent to retrieve its complete trace from Tempo. Verify
the browser flag/exporter and server OTEL filter before an audit; do not infer
that absent spans mean zero cost. Correlate rows, bytes, page count and cache
policy across browser, GraphQL, authorization, properties and SQL. Validate
edits, added rows, picker latency, table/view switching and scrolling separately
on synthetic fixtures after every optimization; this read-only harness covers
opening and reloading only. Preserve the 500-row limits and grid behavior.
