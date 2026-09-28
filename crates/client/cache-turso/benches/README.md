# GraphQL cache query benchmarks

See the [optimization review](OPTIMIZATION_REVIEW.md) for the implementation,
validation and original-baseline comparison. The standalone
[interactive comparison](PAGE_READ_COMPARISON.html) includes every operation's
p50 and p95; download/open the HTML file to use it offline.

These release-mode suites discover every `query` in the web app's production
GraphQL directory and every generated fragment passed to `selectRecords` under
`src/lib/queries`. Currently that is **23 queries and 10 fragment selections**.
The native suites use the real Turso adapter and production Tauri `EngineHandle`,
including its mutex, operation interner and fragment cache. The browser suite
calls the production worker host, WASM engine and persistent Turso OPFS adapter.

Run from the repository root:

```sh
# Fast correctness/coverage smoke: exercises all 13 Soup entity types.
nix develop --command cargo bench --locked -p cache-turso --bench graphql_queries -- \
  --sizes 1,13 --variants 2 --samples 2 --warmup 1 --output /tmp/core-smoke.json

# Extensive engine and storage matrix.
nix develop --command cargo bench --locked -p cache-turso --bench graphql_queries -- \
  --output /tmp/core.json

# Exact native host. Linux needs the Tauri development shell.
nix develop .#tauri-linux --command cargo bench --locked \
  --manifest-path apps/web/tauri/Cargo.toml -p graphql_cache_plugin \
  --bench graphql_queries -- --output /tmp/tauri.json

# Real temporary database files; no application database or hosted data is used.
nix develop .#tauri-linux --command cargo bench --locked \
  --manifest-path apps/web/tauri/Cargo.toml -p graphql_cache_plugin \
  --bench graphql_queries -- --disk --sizes 1,50 --variants 8 \
  --samples 20 --warmup 5 --output /tmp/tauri-disk.json
```

On macOS use the normal native Rust development environment instead of
`.#tauri-linux`. `--filter EmailThread` selects a query/fragment name substring;
a filter matching nothing fails. Defaults are sizes `1,50,250`, variant counts
`32,128`, 30 measured samples, and five warmups. Large variant populations take
several minutes to seed. Sizes are outermost collection cardinalities; nested
collections contain two elements. In particular, grouped-query size counts bins,
not items per bin. Fragment sizes count explicit entity keys. The core and browser
suites split selections larger than the API's 500-key limit into sequential calls
and time the complete selection; `requests_per_read` records that count. The
Tauri-host suite still accepts at most 500 keys per selection.

## Cache population versus response size

`--sizes` controls returned collection entries, **not total cache population**.
A size-50 response can normalize into hundreds of records. Scalar-only operations
do not grow with this setting. Embedded lists can also grow without creating more
normalized records: `MyActivityOverview` has two records at every size, while its
`days` and `topEntities` lists each contain `size` entries. Record count alone does
not describe response size. The earlier 1/50/250 matrices therefore did not
establish scaling with the number of records already in the cache.

The independent population mode uses exactly **50, 1,000 and 10,000 durable
normalized records**, including the selected operation, the root/viewer and
background document records. Use response size 1 to hold the selected work fixed
and let every operation fit in the smallest cache. Background documents have
disjoint IDs, synthetic names and fixed timestamps; normalization checks the
union's exact size.
Native setup verifies all records through Turso. Browser setup writes through the
production API, closes and reopens OPFS, verifies all background identities and
checks the selected result. No storage-count or seeding hook is added to production.

```sh
nix develop --command cargo bench --locked -p cache-turso --bench graphql_queries -- \
  --disk --sizes 1 --variants 1 --cache-records 50,1000,10000 \
  --samples 30 --warmup 5 --output /tmp/population-native.json
nix develop --command cargo bench --locked -p cache-turso --bench graphql_queries -- \
  --sizes 1 --variants 1 --cache-records 50,1000,10000 \
  --export-browser /tmp/population-fixtures
# Build the browser harness as below, then run from apps/web:
bun scripts/cache-wasm/benchmark-queries.ts --fixtures /tmp/population-fixtures \
  --samples 30 --warmup 5 --cold-samples 0 --output /tmp/population-browser.json
```

Each operation has three population scenarios:

- `population-hot`: prewarm the background records and selected response, then
  repeat reads with the normal 10,000-record hot capacity.
- `population-hydrate`: evict the selected normalized records from the hot tier
  before each timed read, preserving Turso. Eviction is outside timing; parsing
  and OS caches remain warm.
- `population-pressure`: use a separate 1,000-record hot tier and read every
  background document before each timed selected read. The background work is
  outside timing; the 10,000-record database exceeds the hot tier. This measures
  a foreground read after churn, not combined foreground/background throughput.

`cache_records`, `normalized_records`, `size`, `hot_capacity` and
`requests_per_read` keep database population, fixture data and hot-tier capacity
separate in the reports. `normalized_records` counts the fixture's seeded
records, including root/viewer records used to seed browser fragments; it is
an upper bound on the records actually visited by that selection. Background
records are document metadata, not a
production-weighted mix of payload sizes or active subscriptions.

To independently stress large returned results, export and run
`--sizes 50,1000,10000 --variants 1` without `--cache-records`. Use
`--scenarios hot-resolvers,hot-json,records-hot` to focus on reads in either suite.
Every discovered query and fragment is checked at all three sizes. A 10,000-item
fragment workload makes 20 sequential calls. These oversized results are stress
tests, not claims that the server normally returns 10,000 items in one page.
In this matrix, `hot-*` means repeated reads after warmup. When a response needs
more than the default 10,000 hot records, repeated reads still fetch from Turso;
they are not wholly memory-resident reads. `normalized_records` reports the
fixture's seeded size, including any fragment-seeding scaffold.

## Browser Turso / WASM / OPFS

Export the same discovered operations, build the production WASM package, then
bundle and run the browser harness. All data stays in disposable browser profiles.
No dev backend, login, production database or running app is needed.

```sh
nix develop --command cargo bench --locked -p cache-turso --bench graphql_queries -- \
  --sizes 1,50,250 --variants 8,32 --export-browser /tmp/gql-browser-fixtures
nix develop --command just --justfile apps/web/justfile build-cache-wasm

# From apps/web (use the repository's Bun/Nix development environment):
bunx --bun vite build --config src/lib/graphql-cache/worker/browser-test/vite.benchmark.config.ts
bun scripts/cache-wasm/benchmark-queries.ts --fixtures /tmp/gql-browser-fixtures \
  --sizes 1,50 --variants 8,32 --samples 30 --warmup 5 --cold-samples 0 \
  --output /tmp/browser.json

# Measure reconnect separately from the broad warm matrix.
bun scripts/cache-wasm/benchmark-queries.ts --fixtures /tmp/gql-browser-fixtures \
  --filter AgentSessionMentions --sizes 1 --variants 8 --samples 5 --warmup 5 \
  --cold-samples 3 --scenarios concurrent-8-total,reopen-first-read \
  --output /tmp/browser-reconnect.json
```

Use `--browser firefox` for Firefox, `--executable-path <path>` for a system/Nix
Playwright-compatible browser, or `--dist <directory>` for a saved bundle.
`--filter EmailThreadPage --scenarios hot,hot-registered` narrows a run. A missing
operation, incomplete batch, incorrect round trip or no-op host fails the run.
The server binds a temporary localhost port and serves only the supplied bundle
and fixtures. The runner closes its browser and server when finished.
The original coordinator can hit a 60-second reconnect timeout, so broad
baseline comparisons should measure cold reads separately as shown above.

Browser times include real coordinator/worker messaging, WASM conversions,
engine work, and OPFS I/O when records are cold. They exclude rendering and
network data fetching. Shared fragment plans are reused by both hosts.

- `hot`, `hot-registered`, `hot-resolvers`, `hot-json`, `unchanged-write`,
  `variants-N`, `capacity-16` and `miss` mirror the native concepts.
- `records-hot` is the real fragment API, including plan lookup. `records-json`
  additionally stringifies the result. `records-parse` appends a unique GraphQL
  comment on every call to force a fresh plan through the same production API.
- `concurrent-8-total` measures a wave from eight cache clients sharing one scope
  and coordinator. It reports total wave latency, not individual-request p95.
- `reopen-first-read` disposes the host and waits for database ownership and client
  liveness locks to release before constructing a new host. Timing includes worker activation,
  WASM initialization, opening an existing OPFS database and the first read.
  Database creation, disposal and fixture seeding are untimed; filesystem caches
  are not flushed. This is different from native `cold-engine`.

Browser seed documents are schema-validated public GraphQL writes. Fixtures
supply valid Soup projection supplements and direct fields, and synthetic JSON
integers stay within JavaScript's exact range. Large floating-point JSON values
have a separate correctness regression test. Browser and native fixtures therefore
share selection shapes, but their absolute times are not interchangeable.

Reports include browser version, measured timer resolution, isolation state,
fixture corpus, bundled assets and fetched WASM SHA-256 hashes, plus raw latency
samples. Firefox runs disable `privacy.reduceTimerPrecision` only in the temporary benchmark
profile to avoid millisecond rounding of sub-millisecond reads; this preference
is reported and does not change the application's configuration. Chromium uses
its default clock. Zero-median samples are reported as unresolved by the comparator.
Use identical browser versions and options and keep each version's WASM package
in its own saved bundle when comparing revisions.

## Native workloads

| Scenario | What is timed | Host |
| --- | --- | --- |
| `hot` | Read with populated LRU and parsed operation, no active registration | Both |
| `hot-registered` | Repeat read for one active operation, including dependency updates | Both |
| `hot-json` | Registered read plus JSON response serialization | Both |
| `hot-resolvers` | Registered read with the app's email-thread entity resolver | Both |
| `unchanged-write` | Normalize and refresh an identical response | Core |
| `cold-engine` | First read in a new engine: parse, queue hydration, durable record loads, denormalization | Core |
| `capacity-16` | Repeated reads with a 16-record LRU, including pages larger than the cache | Core |
| `miss` | A registered read against an empty cache | Core |
| `variants-N` | Read the first page after N distinct argument variants accumulate | Both |
| `ipc-json-codec` | Decode owned request arguments, native read, encode tagged response | Tauri |
| `concurrent-8-total` | Total wall time for eight clients released together on four runtime threads | Tauri |
| `records-hot` | Fragment projection by explicit keys; Tauri includes its cached plan lookup | Both |
| `records-parse` | Explicit parse/validation plus fragment read (diagnostic cost of rebuilding a plan) | Both |

The two argumentless/effectively invariant operations (`MailAccounts` and
`MyActivityOverview`) do not claim distinct-variant coverage. `records-parse`
adds a parse before calling the host, so a baseline host that already parses on
every call performs two parses in that diagnostic. Use `records-hot` to compare
the actual native fragment-read path before and after plan caching.

The Tauri suite includes owned argument construction, matching its public API.
The core suite accepts borrowed arguments. Neither suite times network requests,
Tauri command routing across a live webview, webview scheduling/JSON decoding,
rendering, or device thermal behavior. `ipc-json-codec` is a codec benchmark, not
an end-to-end IPC measurement. `concurrent-8-total` includes task scheduling and
reports time for the whole wave, not individual request p95.

## Fixture and measurement checks

- Queries and reachable fragments are read directly from production sources;
  newly added query operations enter the suite automatically. Fragment discovery
  follows direct `selectRecords(GeneratedFragmentDoc)` call sites.
- Typenames are included for normalized objects. Query documents are validated
  against the server schema plus the client `@cacheOnly` directive. Generated
  variables are coerced against that schema before timing, so invalid inputs fail.
- Fixtures include all selected fields, rotating abstract concrete types, nested
  properties/notifications/attachments, and 5 KB per email body field. Enum values
  come from the schema. They are deterministic synthetic data, not captured users
  or a traffic-weighted production distribution. Cursors are opaque synthetic
  strings; no server attempts to execute them.
- Query and fragment reads must round-trip the seeded response before timing.
  Warm query reads assert hits; misses assert misses. Report generation fails if
  a discovered selected operation has no measured rows.
- Fixture generation, seeding, correctness comparisons, and cold-engine
  construction are outside timing. Read result destruction is included.
  `cold-engine` reuses an open storage connection: it empties the Rust LRU and
  document plans, not the database/OS page caches, and does not measure startup.
- Reports include the discovered inventory, schema hash, options, architecture,
  normalized records per fixture (not total resident records), sorted raw samples,
  and min/median/p95/max/mean in µs.
  p95 uses the nearest-rank method. Always use release builds and the same machine,
  options, storage mode, fixture code and CPU affinity for comparisons.
- All file databases are under a disposable temporary directory cleaned up when
  the suite exits. `--disk` measures native file storage with warm OS caches;
  normal opens and database creation are setup, not measured.

## Comparing revisions

Keep the timed benchmark harness identical across revisions. If an untimed setup
workaround is necessary for the old implementation, record its exact diff, prove
production assets are unchanged, and disclose the potential scheduling/GC effect.
The original-baseline Firefox comparison documents such a settling wait.
Create any additional
worktree with **Herdr**, then run the same commands against the original and
optimized implementations. Run measurements sequentially, after builds finish;
avoid other CPU-heavy jobs. `taskset -c 0-3 <benchmark-executable> ...` can pin both
runs on Linux. Repeat noisy rows before treating them as regressions.

```sh
python3 crates/client/cache-turso/benches/compare.py \
  /tmp/tauri-before.json /tmp/tauri-after.json --csv /tmp/tauri-comparison.csv

# Optional gate, intended for a stable benchmark runner, not arbitrary laptops.
python3 crates/client/cache-turso/benches/compare.py \
  /tmp/tauri-before.json /tmp/tauri-after.json \
  --max-regression-percent 20 --noise-floor-us 5
```

The comparator rejects different hosts, schemas, inventories, architectures,
options, scenario sets, duplicate rows or changed fixture record counts. A gate
fails only when the p50 increase exceeds both the percentage and absolute noise
budgets. Unit tests separately protect cache semantics, plan identity/eviction,
failed parses, dependency changes and teardown; wall-clock thresholds are not
unit-test assertions.

See [100–500-entry reads from a 10,000-record cache](PAGE_READ_RESULTS.md),
[large-result optimization comparisons](SCALE_OPTIMIZATION_RESULTS.md),
[population and large-result baseline results](SCALE_RESULTS.md),
[native results](RESULTS.md), [browser results](BROWSER_RESULTS.md) and the
complete per-scenario CSVs in `results/` for the reference run.
