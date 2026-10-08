# Database performance audit — 2026-10-05–08

At 100,000 stored records, the table opens in **1.73 seconds cold and 1.66 seconds
warm**, compared with 33.82 seconds cold and a Chrome crash on warm reload before
server pagination and virtualization. All 18 final opening samples across three
views were under 3 seconds. These are local measurements, not a production SLA.

The initial view now loads 500 records and mounts about 25 visible rows. Filtering
and ordering cover the entire table on the server before pagination. Opening does
not wait for all 100,000 records to download. The Soup and engine page limits remain
500; boards, tables containing formula columns, and arbitrary SQL retain the
existing engine reader and its 20,000-row cap.

- Profiling PR: <https://github.com/macro-inc/macro/pull/7496>
- Optimization PR: <https://github.com/macro-inc/macro/pull/7539>
- Current measured code: `c517578d32` (optimized frontend bundle, development Rust backend).
- Original optimized measurements: `8bec61c252`, retained below for attribution.
- Local app: <https://wolf-macro-google:26009/app/database/01a111d0-00e3-7069-bb51-3c8603fcf141>
- Synthetic login: `database-profiling@macro.local` (local email-code flow).

## Method and fixture

The original isolated `database-profiling-audit` stack uses its own Postgres on
port 21000 and HTTPS proxy on 21009. The current revalidation uses the separate
`database-profiling-final` stack on 26000/26009. Tests used a private Playwright Chrome
153.0.8010.52, a 1600×1000 viewport, and a synthetic account. The shared Chrome and
the other worktree's stack were not used. Existing databases and volumes were kept.
The host exposes 144 logical Intel Xeon 6985P-C cores and about 283 GiB RAM; it is
shared with other development work. Both frontends are optimized Vite bundles
configured for the local backend. The current bundle is staged in Caddy. Its
build explicitly enables databases and browser telemetry, exporting to the local
`/i/otlp/v1/traces` endpoint. No Vite development server is used for final timings.

The fixture contains 100,000 Records, 20 Accounts, and nine columns: Name, Amount,
Bucket, Stage, Active, Due, Website, Notes and Account. Values include text, numbers,
selects, booleans, dates, links and record references. Records were grown through
1k, 5k, 10k, 25k, 50k and 100k stored entries. The selective views are Bucket 99
(1,000 matches) and Stage New plus the first Account (1,667 matches).

The committed [measurement harness](apps/web/scripts/database-profile/measure.mjs)
records navigation through the first populated grid and two animation frames.
This is a rendering opportunity, not proof of a physical paint. Polling adds up to
100 ms uncertainty. Each cold sample starts with a fresh browser context containing
login state; its warm sample reloads the same context. “Cold” does not mean a cold
Postgres buffer cache or operating-system filesystem cache. Final results use three
repetitions per view, with CPU profiling disabled and browser tracing enabled.
A TypeScript check overlapped the beginning of the original optimized run.
The current final runs started after seeding, builds and recovery of the local
collaboration gateway finished. The final browser runs used an isolated network
namespace so unrelated host Docker network changes could not interrupt requests.
The integrated app's default service-worker behavior was retained.

The new fixture was also grown through all six sizes. Its 1k–25k opening checks
were preflight runs with browser tracing disabled and are excluded from the final
comparison table. At 50k, a traced cold/warm pair measured 1.976/1.216 seconds.
The 100k results below contain three traced cold/warm pairs for each view.

Raw results, traces, SQL plans, profiles and logs are under
`/home/wolf/tmp/database-profiling/`. Credentials remain outside git. See the
[profiling guide](apps/web/scripts/database-profile/README.md) for reproduction,
span definitions and safe Postgres statistics collection. Measurements use deltas
from `pg_stat_statements`; shared statistics were not reset.

## Opening results

Current code, 100,000 stored records, first 500 matching records loaded. Values are
seconds, **median [minimum–maximum]**, three samples in each column.

| View | Cold | Warm |
| --- | --- | --- |
| All records | **1.731 [1.665–1.801]** | **1.662 [1.628–1.910]** |
| Bucket 99 | **1.956 [1.869–2.024]** | **2.337 [1.872–2.890]** |
| Stage + Account | **1.936 [1.743–1.962]** | **2.294 [1.922–2.338]** |

Source: `entity-final/main-integrated-100000-{all,filtered,indexed}/results.json`.
All 18 samples mounted exactly 25 rows. This revalidation includes main through
`b9f4217a52`. Warm navigation is slower and more variable than the previous build;
these latest results replace the earlier numbers as the current performance claim.

The previous integration (`9a4bd03d65`) measured:

| View | Cold | Warm |
| --- | --- | --- |
| All records | **1.975 [1.952–1.988]** | **1.163 [1.079–1.200]** |
| Bucket 99 | **2.093 [2.084–2.160]** | **1.245 [1.161–1.302]** |
| Stage + Account | **1.991 [1.986–2.177]** | **1.140 [1.133–1.153]** |

Source: `entity-final/entity-healthy-100000-{all,filtered,indexed}/results.json`.
That was a fresh-fixture revalidation after the upstream entity refactor and local
service recovery. Upstream startup changes, environment and serving differences
prevent attributing the differences between these runs to one change.

The original optimized build (`8bec61c252`, October 5) measured:

| View | Cold | Warm |
| --- | --- | --- |
| All records | **2.308 [2.300–2.331]** | **1.287 [1.278–1.343]** |
| Bucket 99 | **2.475 [2.435–2.541]** | **1.462 [1.425–1.480]** |
| Stage + Account | **2.367 [2.280–2.592]** | **1.295 [1.246–1.326]** |

Source: `paging-release-100000-{all,filtered,indexed}/results.json`.

The scale audit exposed the previous materialization and mounting cost:

| Stored records | Initial rows loaded before paging | Cold opening | Warm opening |
| --- | ---: | ---: | ---: |
| 1,000 | 1,000 | 4.458 s | 3.498 s |
| 5,000 | 5,000 | 11.047 s | 11.132 s |
| 10,000 | 10,000 | 17.544 s | 17.557 s |
| 25,000 | 20,000 | 36.245 s | Chrome crashed |
| 50,000 | 20,000 | 36.512 s | Chrome crashed |
| 100,000 | 20,000 | 37.370 s | Chrome crashed |
| 100,000, improved Soup SQL | 20,000 | 33.823 s | Chrome crashed |

The first three rows are three-sample medians. Runs that crashed have one completed
cold sample; they are not medians. These are successive audit stages, not one
unchanged binary at every size. Sources: `baseline-1000`,
`healthy-baseline-5000`, `text-10000`, `text-{25000,50000,100000}-all`,
and `final-100000-all`.

At 100k, the previous numeric filtered view took 15.058 s cold / 23.323 s warm;
the indexed cohort took 6.050 s / 4.139 s. The warm numeric regression was real:
the capped engine replayed many pages after cache eviction. Increasing retention
alone did not solve scaling. Virtualization alone stopped the huge DOM/crash but
still waited for capped reads. Server pagination removed that opening work.

An intermediate paged build measured 2.718 s / 1.643 s for all records and
3.330 s / 2.278 s for the indexed cohort. The final property-index and cache-opening
changes account for the last improvement. These results are preserved in
`paging-controlled-100000-*`.

## Attribution through the stack

Current median-cold traces confirm browser-to-Postgres propagation and the
expected 500-row read. Timings below are milliseconds and include child spans.

| View | Trace | Ordered-ID SQL | GraphQL including serialization | Serialization |
| --- | --- | ---: | ---: | ---: |
| All records | `f9c8cfc1c6cae251f581162d1cfa6b8c` | 5.53 | 194.54 | 28.61 |
| Bucket 99 | `11e311c4aac6c25ab9968c44e1e37aaf` | 204.52 | 382.98 | 29.88 |
| Stage + Account | `c6636043be69f92e34cdb16d037d4c90` | 72.72 | 252.09 | 29.37 |

Connection acquisition was about 0.4 ms for the all-records sample. Browser row
decoding took 8.9 ms, publication took 34.8 ms, and the database query span took
398.8 ms. App startup and other browser work account for much of the remaining
1.73-second navigation time.

The slowest warm sample (Bucket 99, 2.890 seconds) has trace
`ef52acf0b33cf2498c5ad7b8af8cf51c`. Its database query span took 997.1 ms, including
203.8 ms of ID selection, 403.0 ms of GraphQL execution, 4.6 ms of browser decoding
and 25.7 ms of publication. The HTTP request began about 471 ms after the query
span began; earlier navigation also contains a roughly one-second gap between
metadata and block requests. These timings identify work outside SQL as a remaining
target, but do not establish the cause of the startup/request scheduling delays.

The following before/after attribution uses the original optimized run so it
remains paired with the SQL plans and profiles collected during those iterations.
Representative trace IDs below are query traces, not unrelated bootstrap requests.
Timings are inclusive; parent and child durations must not be summed.

| Scenario | Before trace | Final trace |
| --- | --- | --- |
| All records | `2d56848faeb84bc8b515e7911651fae0` | `fd5f1f124d1148ba1b0e1acc01a5cec4` |
| Numeric filter | `769c5ec8fa461febfe3a314adbc05a7a` | `f06fdfb13b5d1126c69da6811055200c` |
| Stage + Account | `ae483a5126ab90582c51a44b6e684f1f` | `5144646b50b90f276e91b83f5b358bb6` |

The all-records final trace belongs to the median cold sample. Its ordered-ID SQL
took 5.08 ms; GraphQL execution including serialization took 188.54 ms, of which
serialization was 28.79 ms. Browser cell decoding took 44.6 ms and synchronous
publication 48.9 ms. The database query span lasted 475.9 ms; navigation and app
bootstrap account for much of the remaining opening time.

The numeric filter's final median-cold trace spent 206.77 ms selecting IDs and
426.98 ms executing GraphQL. The indexed cohort's representative cold trace spent
234.68 ms selecting IDs; representative warm trace
`42eeca1e4f3214d0adff8807222fde29` spent 77.33 ms. A standalone EXPLAIN comparison
reduced that cohort's selection from 796.83 ms to 163.81 ms by exposing positive
JSONB membership to the existing GIN index and preserving indexable joins in both
directions. The typed predicate still determines scalar, list and empty semantics.

Before pagination, the all-records trace spent about 11.57 seconds fetching,
0.39 seconds folding, and 16.67 seconds publishing 20,000 rows. The old browser
reached about 3.47 GB JavaScript heap and 2.08 million DOM nodes. Earlier Soup
EXPLAINs also exposed avoidable scans: pruning impossible project branches and
preserving UUID joins reduced an individual 501-row SQL page from 115.73 ms to
roughly 3–5 ms. Faster individual pages could not eliminate the cost of reading
and mounting forty pages on opening.

Instrumentation covers browser query/decode/publication/frame, cache requests and
queueing, GraphQL execution/serialization, authorization/catalog reads, property
hydration, connection acquisition and PostgreSQL selection. The collector lost its
Docker network attachment after a restart; it was reattached before the final
release measurements. Missing spans from the earlier intermediate run are not
treated as zero-cost work.

## Interaction and deep-read checks

Current-code browser interaction results, milliseconds. Table switches and edits
are three-sample medians; the picker, insert and view switch are single samples.
Edits measure the visible optimistic result separately from the HTTP response.

| Action | All records | Stage + Account |
| --- | ---: | ---: |
| Cached table switch | 430.7 | 514.4 |
| Visible edit | 19.5 | 17.4 |
| Edit HTTP response | 57.7 | 50.2 |
| First picker open | 66.3 | 68.9 |
| Insert HTTP response | 146.1 | 109.7 |
| Switch to numeric filtered view | 901.5 | — |
| Scroll frame interval p50 / p95 | 16.7 / 66.6 | 16.7 / 66.7 |

The numeric view-switch check waits for Record 099001, proving the new filter's
membership is visible. The earlier 133.1 ms check waited only for 500 rows; because
both views have that count, it did not establish completion of the view change.
Inserted records opened with the exact submitted name, including the saved draft
that remains editable outside a filtered view. The harness follows the accessible
record-opening control or the creation notice; a retained draft's UI identity can
differ from its saved server ID.

Scroll uses sixty 800-pixel wheel events, about 16 ms apart. Maximum observed
frame intervals were 83.4 ms (all) and 100.0 ms (indexed), so this is not a claim of
smooth 60 fps. Both runs had no page errors. Temporary edits and inserted records
were restored/deleted; their cleanup journals are empty. Sources:
`entity-final/interactions-main-all` and
`entity-final/interactions-main-indexed`.

After the machine restart, LocalStack's temporary resources were missing and the
collaboration gateway had exited. Writes committed quickly but waited 3–4 seconds
for failed gateway notifications. Idempotent LocalStack provisioning and restarting
the existing gateway restored 50–53 ms median write acknowledgement without a code
change or database reset. All final interaction measurements above use the
recovered services.

A separate stress run on the current code requested all 200 pages and reached
100,000 loaded records in **87.45 seconds**, with **26 mounted rows**, **3,854 DOM
nodes**, and **303.46 MB JavaScript heap after GC**. The last record opened, no page
errors occurred, and switching to Accounts took **99.0 ms**. Heap immediately after
that switch was **302.29 MB**. Source: `entity-final/deep-main`. The fixture
ended with exactly 100,000 Records and 20 Accounts.

The original optimized deep test also requested all 200 pages, collecting garbage
at milestones. It reached 100,000 rows in **89.35 seconds**, with **26 mounted rows**,
**3,701 DOM nodes**, **308.48 MB JavaScript heap after GC**, and no page errors.
The last record opened successfully. Switching to Accounts afterward took
**82.8 ms**, compared with **10,130 ms** before the cache-opening fix. Heap just
after that switch remained **308.26 MB**; the test does not establish eventual
reclamation of the retained data/cache work. Source: `paging-deep-final`.

Earlier append code repeatedly decoded accumulated pages and took 226.69 seconds
to traverse the same 100k fixture. Reusing unchanged decoded cells brought this
to about 90 seconds. These stress timings include GC pauses and are distinct
from the opening measurements above.

## Changes and correctness

The GraphQL field `user.databaseViewRows(databaseId, input)` accepts a typed view
query and cursor. The existing view compiler validates filters and sorts against
the authorized catalog. PostgreSQL evaluates them globally, applies stable ordering
with row-ID ties, and returns at most 500 rows plus continuation information.
Cursors bind the query, catalog and table version; concurrent changes restart the
read instead of mixing versions. The response uses canonical Soup row entities.

The hexagonal boundary was checked: typed access receipts and domain services own
authorization and use-case policy; the GraphQL adapter maps transport types; the
database repository owns SQL and transactions. Generic property mutations now
reject database-row targets so edits cannot bypass database versions and the change
journal. Supported row writes continue through database operations.

| Commit | Change and reason |
| --- | --- |
| `9e8e5ef8b4` | Browser query, fetch/fold, comparison, publication and frame spans. |
| `a822d25b79` | Repeatable local scale harness and profiling instructions. |
| `f2a37be54c` | Separate connection wait, SQL/decode and response serialization. |
| `df6f0713e4` | Restrict profiling capture to relevant backend database requests. |
| `757f813c9b` | Preserve unchanged grid rows and shared cell setup across edits. |
| `ef2d6e603a` | Retain complete capped reads in the bounded page cache. |
| `d2d4e28e7c` | Prune impossible Soup branches; index row cursors and UUID joins. |
| `0e40f2b68a` | Cancel superseded reads between pages while allowing accepted writes to finish. |
| `36ec95efdf` | Authorized, globally filtered and ordered server pages; typed GraphQL and cursor/version checks. |
| `2d288e3991` | Paged table source, virtual rows, focus/edit preservation and incremental cell decoding. |
| `aeba0c1a0f` | Use property membership indexes without changing canonical filter semantics. |
| `151003d902` | Start network reads while the cache is busy; retain offline fallback using the real client's stream semantics. |
| `8bec61c252` | Regenerate dependency unification and closure metadata required by CI. |
| `73a084633c` | Integrate current main and regenerate the closure after the upstream crate move. |
| `0025b45ee9` | Preserve cancellation classification during engine opening; build and remove indexes concurrently with safe interrupted-build retries. |
| `9a4bd03d65` | Integrate the upstream storage/entity split while retaining paged reads, stable virtual rows and optional schema actions. |
| `c517578d32` | Integrate main through the AI/PSD editors and regenerate dependency closures; rebuild and remeasure the combined app. |

API traversal verified all 100,000 unique IDs in manual order, both endpoint
numeric cohorts (Bucket 0 and Bucket 99, exactly 1,000 each), the 1,667-row indexed
cohort, and the globally largest 1,000 Amount values in descending order
(1099.99 through 1090.00). Tests cover ties, nulls, scalar/list differences,
case mapping, wildcard escaping, nanosecond dates, stale cursors, late responses,
disposal and offline behavior. Real URQL plus the normalized cache exchange is used
for the new cache/network tests; mocking only the page function concealed an
operation-deduplication problem during review, which was fixed before publication.

Validation: 590 frontend tests across 83 files; TypeScript; `just check`; generated
dependency verification; production frontend build and local DSS build; five QC
reviews. Affected Rust suites passed: `database_sql` (136), `databases_sql` (35),
`databases` with Postgres/view features (222), `properties` (273, four ignored),
`soup` (258, two ignored), `cache-core` (96 unit tests plus integration suites),
`graphql_databases` (1), `complete_graph` (59), and DSS binary tests (17). Tests ran
from the repository root with SQLX_OFFLINE unset. SQLx metadata and GraphQL schema
were generated using the repository tools.

For CI integration, the branch was merged with `main` at `55f06de203` and the
dependency generator updated the closure entry for the relocated `agent_fold`
crate. The database optimization code was unchanged. The 590 frontend tests,
TypeScript and schema checks, scoped `just check`, generated dependency check,
and the `database_sql`, `databases_sql`, `databases`, `graphql_databases`,
`complete_graph` and DSS suites passed again. These checks used a separate test
database; the measured 100k fixture and running bundle were preserved.

Review follow-up verified the index migrations against separate 100k-row fixtures.
The original build blocked another insert until its 400 ms lock timeout; the
concurrent build allowed the insert while waiting for an older transaction.
Cancelling a build left an invalid index, and retry correctly failed instead of
silently accepting it. Successful migration runs remain no-ops on rerun through
the SQLx ledger. Each concurrent operation has its own nontransactional migration
because PostgreSQL treats a multi-statement SQLx batch as an implicit transaction.
Both final cursor indexes were valid. Evidence: `review-index-locks.json`.

The engine-open cancellation regression failed before the fix and passed after
it. All 12 driver tests, seven paged-reader tests, 222 database tests, two migration
tests, TypeScript, `just check`, and five follow-up QC reviews passed.

The subsequent integration with `main` at `4f83c028f2` introduced the upstream
`database_entities` boundary. On head `9a4bd03d65`, 604 frontend tests across 84
files, all five standalone browser tests, TypeScript, `just check`, generated
dependency verification and five integration reviews passed. Backend revalidation
passed 226 database tests, 35 database-query service tests, one GraphQL adapter
test, 59 complete-graph tests, 312 Soup tests with the `all` feature (four ignored),
and 273 property tests (four ignored). All code and test CI checks passed on that
head; the optional preview deployment was cancelled to keep runtime work local.

The upstream entity-split migration discards existing database content. It was
applied only to a new test database and the fresh `database-profiling-final` stack;
the original 100k fixture was preserved. The hexagonal boundary was checked:
GraphQL forwards authenticated, typed requests to the domain service; the domain
owns authorized catalog access and cursor/query policy; the Postgres adapter owns
SQL and transaction mechanics. Core storage without an app entity stays outside
app discovery and canonical Soup hydration.

The final integration includes `main` at `b9f4217a52`. GitHub's combined-tree CI
found two missing transitive dependency entries after main added the AI and PSD
engines; the dependency generator repaired them. Revalidation passed 614 frontend
tests, seven standalone browser tests, TypeScript, 139 database-engine tests,
228 database tests, 35 query-service tests, one GraphQL adapter test, 60 complete-
graph tests, 17 DSS tests and five QC reviews. The standalone browser ran in the
isolated network namespace after host network changes interrupted module downloads.
TypeScript passed with a 16 GiB Node heap after exhausting the default 4 GiB limit.
The unrelated agent-fold WASM suite also passed both tests locally after a cold
build hook timed out in the earlier CI run. The optimized frontend, all eight WASM
modules and DSS were rebuilt before the current measurements. API traversal and
the browser interaction/deep-read checks above passed again on `c517578d32`.

### October 8 main integration

Main through `9f2a13df42` is integrated, including the shared database UI, sticky
summaries and formula columns. Local revalidation passed 822 frontend tests in
117 files, nine browser tests, TypeScript and schema checks. Rust revalidation
passed 244 database tests, 39 database-query service tests, one GraphQL adapter
test, 68 complete-graph tests and 29 DSS tests with SQLX_OFFLINE unset.

The integration preserves editor focus when virtualized rows cross the sticky
header/footer and when adding or removing formulas switches readers. Formula
tables retain the existing engine reader; a delayed or failed handoff keeps the
displayed rows and their partial-result label until its replacement arrives.
These are functional checks of the integration, not new opening benchmarks.
The performance measurements and the local demo above remain on `c517578d32`.

## Remaining limits

- This achieves the requested opening target on the local table fixture. Broader
  production datasets, hardware, network latency and concurrent load still need
  production measurements. App bootstrap is now a larger share than SQL for the
  unfiltered first page.
- Loading every page remains proportional to the rows requested. Very deep reads
  accumulate decoded rows and background cache persistence work. Virtualization
  bounds mounted DOM, not the complete in-memory dataset.
- Refreshing after a write currently re-reads the number of pages already loaded
  to preserve global membership/order. After loading all 100k, this is expensive.
  Sustained concurrent writes can exhaust the automatic retry and show a refresh
  error. Resetting to the first page after every edit would lose the user's place.
  A bounded page window and targeted invalidation with correct cursor/version
  handling are the next changes for sustained deep editing.
- Boards retain the existing capped reader. They need pagination designed around
  lanes and card order; arbitrary SQL also retains its current engine limit.
  After integration with formula columns on October 8, tables containing formulas
  use that engine too, so their computed values, filters and sorts remain correct.
  The opening measurements above cover tables without formula columns.
- Aggressive scrolling still has long frames. Cell mounting/paint and cache
  backpressure remain worth profiling separately from opening latency.

The repository automatically published frontend previews when the PRs were opened.
Both previews were removed using the repository cleanup workflow. Runtime testing
and the link above use only the isolated local stack; the PR was not merged and
no backend release was deployed.
