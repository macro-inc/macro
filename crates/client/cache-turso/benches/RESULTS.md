# GraphQL cache performance results

Reference measurement: 2026-09-26, Linux x86_64, AMD EPYC 9B45 virtual machine.
Release binaries were pinned to CPUs 0–3 and run sequentially after builds/tests
finished. The Tauri concurrency workload uses four runtime workers. This is a
shared machine, so these results describe this synthetic workload, not a device
latency guarantee.

Baseline: `ea7a41f9fd8a9106b839fad3695aac06ccb6244a`. Both versions used the same
new benchmark harness, fixtures, schemas and dependencies; only the production
cache implementation differed. These native measurements cover the original
optimization pass. A subsequent browser pass moved fragment plans into the shared
core and enabled exact JSON float parsing; the historical native numbers below
were not remeasured with that parser feature. See
[browser results](BROWSER_RESULTS.md) for the final WASM build and native
confirmation. Schema hash:
`bed4aba95ed3c84a1712991c7ff8870331eb80799e188f7e79065e1e4559d654`.

## Coverage and reproduction

All **22 production queries and 10 fragment selections** were exercised in both
the core/Turso engine and the production Tauri `EngineHandle`. The six matrices
contain **2,060 paired scenario measurements** (4,120 before/after distributions).
Each distribution includes the configured number of measured calls, after
warmup. Seeding, fixture construction and correctness comparisons are untimed.

Build the two executables using [the benchmark instructions](README.md), then run
each baseline/optimized executable with each of these argument sets:

| Matrix | Arguments | Core rows | Tauri rows |
| --- | --- | ---: | ---: |
| Standard | `--sizes 1,50 --variants 32,128 --samples 40 --warmup 10` | 472 | 384 |
| Large | `--sizes 250 --variants 8,32 --samples 20 --warmup 5` | 236 | 192 |
| Disk | `--disk --sizes 1,50 --variants 8 --samples 20 --warmup 5` | 432 | 344 |

Use `taskset -c 0-3 <executable> <arguments> --output <report.json>` on Linux.
The large matrix covers 250 explicit fragment keys or outermost collection
entries; grouped-query sizes count bins with two entries in each nested list.
Disk runs use disposable file databases and warm OS caches.

Complete paired p50/p95 measurements, including slower rows:

- Standard: [core](results/standard-core.csv), [Tauri](results/standard-tauri.csv).
- Large: [core](results/large-core.csv), [Tauri](results/large-tauri.csv).
- Disk: [core](results/disk-core.csv), [Tauri](results/disk-tauri.csv).

## Bottlenecks fixed

1. Denormalization cloned every visited normalized record, including fields the
   query did not select. Viewer records containing many cached argument variants
   and email records containing bodies made this particularly expensive. Reads
   now borrow the immutable source, including concrete type names and field keys
   without arguments.
2. Native fragment reads parsed and validated the entire fragment document on
   every call. A 128-entry LRU now reuses successful plans, keyed by both document
   text and fragment name. Invalid plans are never cached.
3. Batch fragment reads copied hot base records before projecting them. They now
   borrow hot records, retaining owned copies only for cold loads and optimistic
   compositions. They preserve caller key order and refresh linked-record recency.
4. Every registered query rebuilt its reverse dependency index even when the
   dependency set was identical. The unchanged-set path now returns immediately;
   changing dependencies and teardown retain their existing behavior.
5. The query document map allocated the whole query string on every lookup and
   grew without a limit. Borrowed lookups now reuse a bounded 128-entry LRU.
6. Cold promotions could evict a hot record used in the same read. Hot dependency
   recency is now refreshed before promotions, retaining a mixed hot/cold working
   set when it fits the cache.

## Per-query native reads

Standard matrix, size 50, registered reads with the production entity resolver
(`hot-resolvers`). Times are microseconds; speedup is before p50 / after p50.

| Query | Before p50 | After p50 | After p95 | Speedup |
| --- | ---: | ---: | ---: | ---: |
| AgentSessionMentions | 63.0 | 41.2 | 46.1 | 1.53× |
| ChannelListSoup | 956.8 | 708.6 | 1031.8 | 1.35× |
| ChannelUnreadPresence | 81.7 | 41.3 | 42.0 | 1.98× |
| EmailThreadPage | 2028.4 | 1451.6 | 1757.2 | 1.40× |
| EntityActivity | 414.0 | 299.2 | 399.9 | 1.38× |
| EntityProperties | 482.7 | 339.5 | 358.6 | 1.42× |
| Favorites | 151.2 | 110.4 | 128.9 | 1.37× |
| GroupSoup | 4087.2 | 3004.5 | 4007.3 | 1.36× |
| GroupSoupMembership | 155.0 | 96.8 | 142.4 | 1.60× |
| ItemPreview | 92.0 | 68.1 | 89.3 | 1.35× |
| ItemPreviewFileTypeCacheWrite | 65.9 | 29.3 | 29.8 | 2.24× |
| ItemPreviewNameCacheWrite | 79.8 | 80.1 | 90.3 | 1.00× |
| ItemPreviews | 134.9 | 100.8 | 142.3 | 1.34× |
| MailAccounts | 65.4 | 40.2 | 40.6 | 1.63× |
| MyActivity | 182.8 | 124.0 | 182.6 | 1.47× |
| MyActivityOverview | 109.6 | 68.3 | 82.5 | 1.60× |
| Soup | 2078.4 | 1594.0 | 2271.4 | 1.30× |
| SoupBackfill | 2505.6 | 2278.7 | 2778.8 | 1.10× |
| SoupMailBackfill | 2146.3 | 1634.3 | 2234.2 | 1.31× |
| SoupMembership | 48.3 | 30.8 | 41.9 | 1.57× |
| SoupNotifications | 1027.8 | 738.9 | 753.2 | 1.39× |
| SoupSharedMailBackfill | 3650.0 | 1845.6 | 2214.7 | 1.98× |

## Per-fragment native reads

Actual `records-hot` calls including owned native request arguments and plan
lookup. Times are microseconds. The first pair selects one key; the second selects
50 keys. The final speedup refers to the 50-key batch.

| Fragment | 1 key before p50 | 1 key after p50 | 50 keys before p50 | 50 keys after p50 | 50 keys after p95 | Batch speedup |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ChannelListItemFields | 791.7 | 13.9 | 1979.8 | 738.7 | 913.6 | 2.68× |
| EmailThreadMessageFields | 106.5 | 26.0 | 2496.5 | 1474.7 | 1776.9 | 1.69× |
| GraphqlChannelQuickAccessFields | 19.8 | 2.6 | 318.3 | 159.5 | 174.7 | 2.00× |
| GraphqlChatQuickAccessName | 10.8 | 1.3 | 138.8 | 80.1 | 90.2 | 1.73× |
| GraphqlCrmCompanyQuickAccessFields | 12.9 | 2.1 | 225.2 | 146.6 | 210.4 | 1.54× |
| GraphqlDocumentQuickAccessName | 22.4 | 1.5 | 177.4 | 92.9 | 104.3 | 1.91× |
| GraphqlProjectQuickAccessName | 8.3 | 1.9 | 140.2 | 74.1 | 101.2 | 1.89× |
| ItemPreviewFields | 47.9 | 1.4 | 231.5 | 157.2 | 171.2 | 1.47× |
| MailItemFields | 2228.6 | 28.3 | 5366.0 | 1634.9 | 1807.2 | 3.28× |
| SoupItemFields | 1703.3 | 27.1 | 4088.7 | 1575.9 | 1753.8 | 2.59× |

## Interpretation and limits

For the standard native size-50 matrix, the median of the per-query p50 speedups
is **1.39×** with the production resolver, **3.82×** after 128 argument variants,
**1.35×** with request/response JSON codecs, and **1.35×** for eight concurrent
callers. These are unweighted medians across operation ratios, not an aggregate
application speedup. The 50-key fragment batches improve by a median **1.90×**.

`SoupMembership` with 128 variants falls from **473.5 to 30.5 µs** (15.53×).
A single `SoupItemFields` selection falls from **1,703.3 to 27.1 µs** (62.80×),
and `ItemPreviewFields` from **47.9 to 1.4 µs** (34.18×). At size 50, full `Soup`
reads fall from **2,078.4 to 1,594.0 µs** and `EmailThreadPage` from **2,028.4 to
1,451.6 µs**. Tiny fragment reads benefit disproportionately from removing parse
cost; large batches remain dominated by the selected data.

The disk native size-50 matrix shows a **1.37×** median query speedup with the
production resolver and **1.90×** for fragment batches. Neither the standard nor
disk native matrix has a row slower by both 20% and 5 µs.

Across all six matrices, 21 of 2,060 rows initially exceeded both the 20% and
5 µs regression thresholds. Each affected operation was repeated back to back
with 100 samples, 20 warmups and eight variants. Twenty of those 21 cases no
longer exceeded the threshold. The two large native mail cases improved on
repeat: `SoupMailBackfill` registered reads were 13,620.6 → 9,792.4 µs, and
`SoupSharedMailBackfill` with JSON serialization was 14,647.5 → 9,628.6 µs.

The remaining original flag, the size-1 `ItemPreviewNameCacheWrite`
`unchanged-write` case, persisted in that repeat (15.1 → 22.8 µs). Three further
paired runs pinned both binaries to CPU 0, alternating execution order, with
300 samples, 50 warmups and one variant. All three were effectively unchanged:
15.32 → 15.15, 15.02 → 14.99, and 15.61 → 15.45 µs. This is consistent with
machine/scheduling variability rather than a repeatable write regression.

[All repeat measurements](results/repeats.csv) retain their run identifiers,
affinity, options, and slower rows, including new flags in the repeated matrix.
These checks did not establish a reproducible regression in the originally
flagged cases; they also do not prove every row improves. Use the supplied gate
on a stable runner before making production latency commitments.

These are deterministic schema-validated synthetic fixtures, including every
selected field and 5 KB email body fields. They are not traffic-weighted, and the
full Tauri webview bridge, JavaScript, rendering, network and iOS device behavior
are not measured. `ipc-json-codec` includes request decode, native read and
response encode; it is not live end-to-end IPC. Concurrent timings are total
wall time for eight simultaneous callers, including scheduling and mutex wait.

Large projections still allocate their returned JSON trees, serialize large
responses and traverse selected records. The Tauri handle still serializes
access to mutable cache state. These costs remain visible in the JSON and
concurrent scenarios; changing that model would require a separate concurrency
and consistency design. `cold-engine` includes parsing and durable reads on an
already open connection, not startup or cold OS pages.

`records-parse` intentionally includes an extra explicit parse: the baseline
native host then also parses internally. `records-hot` is the fair comparison of
the actual native fragment entrypoint.

## Validation

- 225 core/Turso tests and 30 Tauri plugin tests passed in release mode.
- Regression tests cover plan identity, bounds/eviction, failed parses, dependency
  reuse/replacement/teardown, and mixed hot/cold fragment recency without repeated
  durable fetches. Existing optimistic and fragment-contract tests pass.
- Every benchmark checks seeded reads before timing, validates query documents
  and input variables, and requires coverage of every selected inventory entry.
- The comparison script rejects incompatible reports; identity, mismatched
  fixture counts, and the optional regression threshold were exercised.
- `just check` and all five QC reviews passed.
- Core storage-port and native-host boundaries were checked. Authorization and
  business policy remain in their existing domain services.
