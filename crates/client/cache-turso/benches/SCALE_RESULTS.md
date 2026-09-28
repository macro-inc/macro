# Turso cache population and large-result scaling

Reference run: 2026-09-26, AMD EPYC 9B45 Linux shared virtual machine; release native code and real browser worker/WASM/Turso OPFS. Processes were pinned to CPUs 0–3 and run sequentially after builds. This is the baseline before the subsequent [large-result read optimizations](SCALE_OPTIMIZATION_RESULTS.md), which reports matched before/after measurements for every operation at all three result sizes.

## What the sizes mean

The earlier fixture size controlled returned collection entries, not total records in the cache. This follow-up separates those dimensions and covers all **22 production queries and 10 fragment selections** in three hosts: native file-backed Turso, Chromium and Firefox. There are **1,350 measured distributions** across the two matrices.

- **Cache population:** exactly 50, 1,000 or 10,000 durable normalized records, including the selected operation and root/viewer. Returned fixture size stays at 1; nested lists still have two entries. Background document IDs are disjoint. The exporter asserts the exact normalized-key union; native setup checks every stored key, and browser setup verifies the background identities after closing/reopening OPFS and validates the selected result.
- **Large results:** fixture sizes 50, 1,000 and 10,000. This is the number of outer collection entries or fragment keys, not normalized records. GroupSoup sizes count bins with two nested entries. Scalar-only queries do not grow. Embedded lists can grow without creating more normalized records: `MyActivityOverview` stays at two records while both `days` and `topEntities` contain `size` entries. Record count alone does not describe response size. Each row reports the fixture normalized-record count (including root/viewer scaffold for browser fragment seeding). Fragment reads use 1, 2 or 20 sequential calls of at most 500 keys and measure the entire workload.

## Cache-population results

Each entry below is the unweighted median of the 32 operation p50 latencies, in milliseconds. All cases use 30 samples after five warmups.

| Host | Scenario | 50 records | 1,000 records | 10,000 records |
| --- | --- | ---: | ---: | ---: |
| native | population-hot | 0.004 | 0.004 | 0.004 |
| native | population-hydrate | 0.048 | 0.070 | 0.074 |
| native | population-pressure | 0.010 | 0.065 | 0.230 |
| chromium | population-hot | 0.300 | 0.300 | 0.250 |
| chromium | population-hydrate | 0.700 | 0.700 | 0.650 |
| chromium | population-pressure | 0.300 | 0.300 | 0.700 |
| firefox | population-hot | 0.760 | 0.750 | 0.750 |
| firefox | population-hydrate | 2.120 | 2.370 | 2.360 |
| firefox | population-pressure | 0.800 | 1.450 | 3.350 |

`population-hot` prewarms the background records and selected response in the default 10,000-record hot tier. `population-hydrate` evicts the selected records before every timed read, keeping Turso and OS caches intact. `population-pressure` uses a separate 1,000-record hot tier and reads every background document before each timed selected read. Eviction/background reads are outside timing; pressure numbers are foreground latency after churn, not total workload throughput.

## Large-result reads

Unweighted median per-operation p50 latency in milliseconds. Queries use `hot-resolvers` (22 operations); fragments use `records-hot` (10 operations). These are repeated reads after warmup. When the records visited by a selection exceed the 10,000-record hot tier, reads continue fetching from Turso. Fixture counts include seeding scaffold and may exceed the number actually visited. Browser JSON serialization is measured separately in `hot-json`.

| Host | Operation kind | 50 items | 1,000 items | 10,000 items |
| --- | --- | ---: | ---: | ---: |
| native | Queries | 0.10 | 2.26 | 125.07 |
| native | Fragments | 0.13 | 2.49 | 47.39 |
| chromium | Queries | 0.80 | 8.05 | 189.65 |
| chromium | Fragments | 1.00 | 9.95 | 100.55 |
| firefox | Queries | 2.30 | 33.97 | 757.28 |
| firefox | Fragments | 2.36 | 45.32 | 485.96 |

The large-result matrix includes multi-second reads. Selected examples at fixture size 10,000:

- `GroupSoup`: native 3.11 s, chromium 4.07 s, firefox 14.44 s p50.

- `EmailThreadPage`: native 2.12 s, chromium 3.13 s, firefox 11.63 s p50.

Every Chromium operation (latencies in milliseconds):

| Operation | p50 at 50 items | p50 at 1,000 | p50 at 10,000 | p95 at 10,000 | Seeded records at 10,000 | Calls at 10,000 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| AgentSessionMentions | 0.60 | 3.90 | 75.80 | 103.80 | 10,836 | 1 |
| ChannelListItemFields | 2.50 | 40.30 | 953.30 | 1034.60 | 35,831 | 20 |
| ChannelListSoup | 3.10 | 42.70 | 1216.60 | 1279.30 | 45,834 | 1 |
| ChannelUnreadPresence | 0.60 | 3.90 | 68.00 | 77.60 | 11,670 | 1 |
| EmailThreadMessageFields | 7.10 | 144.30 | 2834.80 | 2975.90 | 50,003 | 20 |
| EmailThreadPage | 9.20 | 147.50 | 3127.50 | 3243.40 | 60,003 | 1 |
| EntityActivity | 1.50 | 20.00 | 600.90 | 636.50 | 30,002 | 1 |
| EntityProperties | 1.50 | 21.70 | 625.70 | 657.70 | 30,002 | 1 |
| Favorites | 0.60 | 7.20 | 113.70 | 120.20 | 10,002 | 1 |
| GraphqlChannelQuickAccessFields | 1.20 | 10.90 | 115.20 | 135.80 | 10,002 | 20 |
| GraphqlChatQuickAccessName | 0.70 | 5.30 | 65.00 | 82.30 | 10,002 | 20 |
| GraphqlCrmCompanyQuickAccessFields | 0.70 | 8.80 | 85.90 | 105.60 | 10,002 | 20 |
| GraphqlDocumentQuickAccessName | 0.60 | 7.60 | 83.20 | 102.60 | 10,002 | 20 |
| GraphqlProjectQuickAccessName | 0.80 | 5.30 | 63.40 | 87.10 | 10,002 | 20 |
| GroupSoup | 9.30 | 282.90 | 4074.20 | 4206.70 | 108,335 | 1 |
| GroupSoupMembership | 0.80 | 6.90 | 244.20 | 281.90 | 20,002 | 1 |
| ItemPreview | 0.60 | 5.10 | 91.20 | 111.50 | 10,002 | 1 |
| ItemPreviewFields | 0.70 | 9.00 | 68.70 | 79.00 | 10,002 | 20 |
| ItemPreviewFileTypeCacheWrite | 0.50 | 2.80 | 44.00 | 48.50 | 10,002 | 1 |
| ItemPreviewNameCacheWrite | 0.50 | 5.70 | 74.70 | 88.10 | 10,002 | 1 |
| ItemPreviews | 0.80 | 7.10 | 135.10 | 147.20 | 11,668 | 1 |
| MailAccounts | 0.50 | 3.60 | 57.40 | 60.70 | 10,002 | 1 |
| MailItemFields | 4.70 | 83.00 | 1780.50 | 1849.60 | 54,163 | 20 |
| MyActivity | 0.70 | 8.90 | 132.40 | 147.90 | 10,002 | 1 |
| MyActivityOverview | 0.50 | 3.50 | 32.20 | 37.30 | 2 | 1 |
| Soup | 4.50 | 87.30 | 2076.50 | 2233.70 | 64,166 | 1 |
| SoupBackfill | 5.50 | 116.20 | 3203.70 | 3323.00 | 72,496 | 1 |
| SoupItemFields | 4.80 | 82.30 | 1771.60 | 1878.60 | 54,163 | 20 |
| SoupMailBackfill | 5.20 | 87.20 | 2030.80 | 2169.10 | 64,166 | 1 |
| SoupMembership | 0.40 | 3.40 | 43.90 | 55.60 | 10,002 | 1 |
| SoupNotifications | 2.50 | 41.70 | 1000.50 | 1073.40 | 30,002 | 1 |
| SoupSharedMailBackfill | 5.60 | 89.70 | 2092.60 | 2191.30 | 64,166 | 1 |

## Data, reproduction and limits

- [Every population scenario](results/scale-population.csv), including p50/p95, cache count, fixture record count and hot capacity.
- [Every large-result scenario](results/scale-result-size.csv), including p50/p95 and calls per read.
- [Raw sorted samples and run plan](results/scale-raw.json.gz), including browser versions and actual WASM/bundle/corpus hashes.
- [Reproduction commands and scenario definitions](README.md#cache-population-versus-response-size).

Native runs use `--disk`. Population runs use `--sizes 1 --variants 1 --cache-records 50,1000,10000 --samples 30 --warmup 5`. Large-result runs use `--sizes 50,1000,10000 --variants 1 --scenarios hot-resolvers,hot-json,records-hot`: native uses 20 samples/five warmups; each browser uses 30 samples after five warmups at 50/1,000 and 10 samples after two warmups at 10,000. A 10-sample p95 is the maximum observed sample, not a stable production tail estimate. Browser runs disable separate cold-start sampling (`--cold-samples 0`); population setup still checks durable reopen.

All seeded selections must round-trip correctly. Background population records contain document metadata, not a traffic-weighted mix of email bodies, active subscriptions or every entity type. Large-result fixtures exercise the production selection shapes, including 5 KB email body fields; 10,000-item results are oversized stress cases, not normal server page sizes. These numbers exclude network fetching, rendering, live Tauri webview IPC, peak heap usage and cold OS caches. Small browser timings are limited by the browser clock and scheduling. All slower values remain in the data.

Validation: exact population-count assertions, durable-presence checks, full selected-result comparisons, bounded fragment calls, scenario/inventory coverage, sorted-sample/percentile checks, comparator identity and mismatch checks, scoped TypeScript checking, `just check`, and all five code-review roles. Production implementation is unchanged by this scale extension.
