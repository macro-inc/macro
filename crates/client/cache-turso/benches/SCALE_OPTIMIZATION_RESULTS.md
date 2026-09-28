# Large-result cache read optimizations

For ordinary-sized reads, see [100–500-entry responses from a cache containing exactly 10,000 records](PAGE_READ_RESULTS.md). The measurements below stress much larger returned responses.

Measured on 2026-09-26 on the same AMD EPYC 9B45 shared Linux host as [the scale baseline](SCALE_RESULTS.md). Release native file-backed Turso and real Chromium/Firefox worker/WASM/OPFS; measurements ran sequentially on CPUs 0–3 after builds.

## What changed

- **Resume missing branches.** A read retains completed fields and list positions while Turso hydrates missing records. It no longer rebuilds the whole response on each hydration round. This applies to queries and fragment selections, preserves the full dependency set, and never persists partial output or optimistic compositions.
- **Resolve fields once per read.** Schema lookups, fragment/type filtering, field arguments and entity-resolver targets are compiled once for each selection/concrete-type pair and shared by all matching entities in that read. Plans never carry arguments or data across requests.
- **Batch storage lookups.** Multi-record reads use indexed, bounded 128-key SQL batches with a reused prepared statement. Single-record reads keep their point lookup. Ordering, duplicates, absent keys, the transaction snapshot and health latching are preserved. Payload bytes decode directly without an additional blob copy.

The memory-cache capacity remains 10,000 records. There is no response memoization, no reduced fixture size, no skipped selected fields, and no storage format/schema change. The cache engine owns projection and dependencies; the Turso adapter owns SQL. No authorization or application business policy moved across those boundaries.

## Matched scale comparison

All **22 queries and 10 fragment selections** were rerun at **50 / 1,000 / 10,000** returned entries or keys: **486 matched distributions and 10,800 new timed samples**. Comparisons reject mismatched options, host/browser version, schema, fixture corpus, operation inventory, normalized-record counts and calls per read. Baseline rows come from the immediately preceding scale study; the fresh GroupSoup checks below independently repeat before/after measurements with saved binaries.

Each cell below is the unweighted median of per-operation p50 values, **before → after in milliseconds**. It is not a traffic-weighted latency or a tail estimate.

| Host | Kind | 50 | 1,000 | 10,000 |
| --- | --- | ---: | ---: | ---: |
| native | Queries | 0.10 → 0.07 | 2.26 → 1.79 | 125.07 → 69.60 |
| native | Fragments | 0.13 → 0.10 | 2.49 → 2.32 | 47.39 → 41.01 |
| chromium | Queries | 0.80 → 0.75 | 8.05 → 7.10 | 189.65 → 121.90 |
| chromium | Fragments | 1.00 → 0.85 | 9.95 → 9.55 | 100.55 → 95.80 |
| firefox | Queries | 2.30 → 1.83 | 33.97 → 26.63 | 757.28 → 449.36 |
| firefox | Fragments | 2.36 → 2.43 | 45.32 → 41.82 | 485.96 → 463.99 |

Largest representative reads at 10,000 entries/keys, **p50 milliseconds before → after**:

| Operation | Native | Chromium | Firefox |
| --- | ---: | ---: | ---: |
| GroupSoup | 3,111.8 → 2,013.9 (1.55×) | 4,074.2 → 2,834.8 (1.44×) | 14,439.3 → 9,424.0 (1.53×) |
| EmailThreadPage | 2,118.6 → 1,111.1 (1.91×) | 3,127.5 → 2,265.8 (1.38×) | 11,625.8 → 7,902.2 (1.47×) |
| Soup | 1,641.0 → 991.8 (1.65×) | 2,076.5 → 1,387.4 (1.50×) | 7,760.4 → 4,841.4 (1.60×) |
| SoupBackfill | 2,658.4 → 1,211.4 (2.19×) | 3,203.7 → 1,808.8 (1.77×) | 12,075.1 → 6,088.2 (1.98×) |
| ChannelListSoup | 983.3 → 574.0 (1.71×) | 1,216.6 → 778.9 (1.56×) | 4,676.0 → 2,775.7 (1.68×) |
| EmailThreadMessageFields | 1,754.1 → 1,303.8 (1.35×) | 2,834.8 → 2,340.2 (1.21×) | 10,120.4 → 7,953.7 (1.27×) |
| MailItemFields | 1,358.5 → 1,033.6 (1.31×) | 1,780.5 → 1,472.5 (1.21×) | 6,798.8 → 5,042.7 (1.35×) |
| SoupItemFields | 1,347.2 → 1,023.8 (1.32×) | 1,771.6 → 1,460.2 (1.21×) | 6,682.3 → 5,005.4 (1.34×) |

## Every operation

Values are **p50 milliseconds before → after**; all p95 values and JSON-serialization cases are in the CSV.

### native

| Operation | 50 | 1,000 | 10,000 |
| --- | ---: | ---: | ---: |
| AgentSessionMentions | 0.04 → 0.03 | 0.77 → 0.64 | 40.78 → 18.27 |
| ChannelListItemFields | 0.83 → 0.54 | 26.37 → 16.15 | 692.24 → 557.93 |
| ChannelListSoup | 0.63 → 0.53 | 23.84 → 15.53 | 983.29 → 574.03 |
| ChannelUnreadPresence | 0.05 → 0.03 | 1.26 → 0.65 | 42.24 → 24.83 |
| EmailThreadMessageFields | 1.17 → 0.87 | 45.45 → 40.80 | 1,754.06 → 1,303.85 |
| EmailThreadPage | 1.24 → 0.90 | 54.25 → 47.26 | 2,118.55 → 1,111.08 |
| EntityActivity | 0.28 → 0.23 | 9.99 → 5.51 | 453.85 → 265.70 |
| EntityProperties | 0.31 → 0.22 | 11.59 → 8.32 | 488.23 → 302.17 |
| Favorites | 0.09 → 0.07 | 2.02 → 1.75 | 93.23 → 35.56 |
| GraphqlChannelQuickAccessFields | 0.13 → 0.11 | 2.91 → 2.77 | 60.45 → 50.51 |
| GraphqlChatQuickAccessName | 0.05 → 0.05 | 1.30 → 1.34 | 17.49 → 21.73 |
| GraphqlCrmCompanyQuickAccessFields | 0.13 → 0.08 | 2.07 → 1.88 | 34.32 → 31.51 |
| GraphqlDocumentQuickAccessName | 0.07 → 0.06 | 1.70 → 1.75 | 28.78 → 25.24 |
| GraphqlProjectQuickAccessName | 0.05 → 0.05 | 1.29 → 1.33 | 18.68 → 20.77 |
| GroupSoup | 2.79 → 1.90 | 225.63 → 98.86 | 3,111.77 → 2,013.85 |
| GroupSoupMembership | 0.08 → 0.07 | 2.01 → 1.83 | 156.46 → 94.92 |
| ItemPreview | 0.06 → 0.05 | 1.39 → 0.92 | 52.62 → 23.84 |
| ItemPreviewFields | 0.09 → 0.09 | 1.76 → 1.62 | 29.05 → 26.15 |
| ItemPreviewFileTypeCacheWrite | 0.03 → 0.03 | 0.59 → 0.54 | 24.63 → 12.85 |
| ItemPreviewNameCacheWrite | 0.05 → 0.04 | 1.17 → 0.75 | 38.60 → 17.88 |
| ItemPreviews | 0.09 → 0.07 | 2.22 → 1.58 | 91.34 → 44.28 |
| MailAccounts | 0.04 → 0.03 | 0.82 → 0.70 | 32.16 → 13.44 |
| MailItemFields | 1.43 → 1.00 | 55.36 → 35.64 | 1,358.49 → 1,033.60 |
| MyActivity | 0.10 → 0.07 | 2.29 → 1.58 | 93.68 → 40.23 |
| MyActivityOverview | 0.05 → 0.04 | 0.97 → 0.78 | 13.45 → 12.40 |
| Soup | 1.36 → 1.01 | 50.42 → 44.16 | 1,640.96 → 991.82 |
| SoupBackfill | 1.77 → 1.18 | 60.09 → 52.04 | 2,658.45 → 1,211.45 |
| SoupItemFields | 1.63 → 0.97 | 54.95 → 36.80 | 1,347.20 → 1,023.78 |
| SoupMailBackfill | 1.41 → 1.05 | 53.79 → 44.92 | 1,643.93 → 1,003.11 |
| SoupMembership | 0.02 → 0.02 | 0.55 → 0.52 | 22.46 → 13.23 |
| SoupNotifications | 0.66 → 0.45 | 22.63 → 14.78 | 802.39 → 428.59 |
| SoupSharedMailBackfill | 1.56 → 1.10 | 54.99 → 45.92 | 1,704.54 → 1,037.50 |

### chromium

| Operation | 50 | 1,000 | 10,000 |
| --- | ---: | ---: | ---: |
| AgentSessionMentions | 0.60 → 0.60 | 3.90 → 3.70 | 75.80 → 43.10 |
| ChannelListItemFields | 2.50 → 2.20 | 40.30 → 34.40 | 953.30 → 759.80 |
| ChannelListSoup | 3.10 → 2.40 | 42.70 → 39.90 | 1,216.60 → 778.90 |
| ChannelUnreadPresence | 0.60 → 0.40 | 3.90 → 3.80 | 68.00 → 45.80 |
| EmailThreadMessageFields | 7.10 → 7.30 | 144.30 → 139.00 | 2,834.80 → 2,340.20 |
| EmailThreadPage | 9.20 → 7.40 | 147.50 → 136.00 | 3,127.50 → 2,265.80 |
| EntityActivity | 1.50 → 1.40 | 20.00 → 17.20 | 600.90 → 395.90 |
| EntityProperties | 1.50 → 1.30 | 21.70 → 19.60 | 625.70 → 414.40 |
| Favorites | 0.60 → 0.70 | 7.20 → 5.90 | 113.70 → 66.70 |
| GraphqlChannelQuickAccessFields | 1.20 → 0.80 | 10.90 → 10.70 | 115.20 → 109.70 |
| GraphqlChatQuickAccessName | 0.70 → 0.70 | 5.30 → 5.40 | 65.00 → 58.80 |
| GraphqlCrmCompanyQuickAccessFields | 0.70 → 0.90 | 8.80 → 8.40 | 85.90 → 81.90 |
| GraphqlDocumentQuickAccessName | 0.60 → 0.80 | 7.60 → 6.70 | 83.20 → 75.70 |
| GraphqlProjectQuickAccessName | 0.80 → 0.70 | 5.30 → 5.30 | 63.40 → 58.60 |
| GroupSoup | 9.30 → 6.30 | 282.90 → 157.40 | 4,074.20 → 2,834.80 |
| GroupSoupMembership | 0.80 → 0.70 | 6.90 → 6.40 | 244.20 → 161.40 |
| ItemPreview | 0.60 → 0.50 | 5.10 → 4.00 | 91.20 → 45.90 |
| ItemPreviewFields | 0.70 → 0.70 | 9.00 → 7.90 | 68.70 → 66.60 |
| ItemPreviewFileTypeCacheWrite | 0.50 → 0.40 | 2.80 → 2.80 | 44.00 → 30.50 |
| ItemPreviewNameCacheWrite | 0.50 → 0.50 | 5.70 → 4.00 | 74.70 → 41.30 |
| ItemPreviews | 0.80 → 0.80 | 7.10 → 6.20 | 135.10 → 82.40 |
| MailAccounts | 0.50 → 0.50 | 3.60 → 3.50 | 57.40 → 37.30 |
| MailItemFields | 4.70 → 4.20 | 83.00 → 71.40 | 1,780.50 → 1,472.50 |
| MyActivity | 0.70 → 0.70 | 8.90 → 7.80 | 132.40 → 80.90 |
| MyActivityOverview | 0.50 → 0.70 | 3.50 → 3.20 | 32.20 → 29.60 |
| Soup | 4.50 → 4.10 | 87.30 → 75.20 | 2,076.50 → 1,387.40 |
| SoupBackfill | 5.50 → 5.60 | 116.20 → 96.50 | 3,203.70 → 1,808.80 |
| SoupItemFields | 4.80 → 3.80 | 82.30 → 71.90 | 1,771.60 → 1,460.20 |
| SoupMailBackfill | 5.20 → 4.40 | 87.20 → 76.60 | 2,030.80 → 1,401.10 |
| SoupMembership | 0.40 → 0.40 | 3.40 → 2.70 | 43.90 → 27.30 |
| SoupNotifications | 2.50 → 2.20 | 41.70 → 31.90 | 1,000.50 → 608.70 |
| SoupSharedMailBackfill | 5.60 → 4.80 | 89.70 → 76.00 | 2,092.60 → 1,424.50 |

### firefox

| Operation | 50 | 1,000 | 10,000 |
| --- | ---: | ---: | ---: |
| AgentSessionMentions | 1.26 → 1.16 | 12.80 → 11.22 | 296.24 → 157.24 |
| ChannelListItemFields | 7.42 → 6.92 | 162.90 → 120.76 | 3,667.06 → 2,797.40 |
| ChannelListSoup | 8.22 → 6.60 | 173.74 → 128.92 | 4,676.04 → 2,775.74 |
| ChannelUnreadPresence | 1.38 → 1.18 | 13.62 → 10.46 | 315.82 → 189.62 |
| EmailThreadMessageFields | 25.00 → 20.00 | 519.08 → 454.66 | 10,120.38 → 7,953.72 |
| EmailThreadPage | 24.70 → 20.74 | 550.74 → 459.52 | 11,625.82 → 7,902.18 |
| EntityActivity | 4.16 → 3.46 | 85.48 → 62.24 | 2,267.46 → 1,376.74 |
| EntityProperties | 4.60 → 3.88 | 84.02 → 68.56 | 2,348.24 → 1,447.80 |
| Favorites | 2.00 → 1.82 | 27.48 → 24.12 | 522.30 → 256.66 |
| GraphqlChannelQuickAccessFields | 2.62 → 2.42 | 50.50 → 45.82 | 565.04 → 524.10 |
| GraphqlChatQuickAccessName | 1.68 → 1.72 | 32.00 → 28.16 | 290.80 → 301.36 |
| GraphqlCrmCompanyQuickAccessFields | 2.10 → 2.44 | 40.14 → 37.82 | 406.88 → 403.88 |
| GraphqlDocumentQuickAccessName | 1.96 → 2.02 | 38.78 → 32.02 | 375.96 → 371.34 |
| GraphqlProjectQuickAccessName | 1.64 → 1.98 | 27.78 → 27.90 | 324.36 → 309.18 |
| GroupSoup | 33.12 → 24.56 | 1,152.12 → 490.48 | 14,439.26 → 9,424.00 |
| GroupSoupMembership | 1.74 → 1.84 | 31.62 → 27.84 | 901.18 → 603.38 |
| ItemPreview | 1.80 → 1.36 | 20.06 → 13.96 | 399.26 → 170.80 |
| ItemPreviewFields | 1.72 → 1.66 | 32.46 → 27.76 | 328.56 → 286.12 |
| ItemPreviewFileTypeCacheWrite | 1.52 → 1.18 | 10.20 → 8.98 | 213.78 → 116.04 |
| ItemPreviewNameCacheWrite | 1.36 → 1.22 | 19.82 → 11.12 | 343.70 → 150.00 |
| ItemPreviews | 2.12 → 1.58 | 26.68 → 20.32 | 586.62 → 278.70 |
| MailAccounts | 1.24 → 1.12 | 14.38 → 14.78 | 283.72 → 159.10 |
| MailItemFields | 15.86 → 12.16 | 342.22 → 242.02 | 6,798.80 → 5,042.66 |
| MyActivity | 2.48 → 1.80 | 36.32 → 25.42 | 613.38 → 295.34 |
| MyActivityOverview | 1.44 → 1.26 | 13.98 → 9.96 | 133.02 → 102.08 |
| Soup | 17.04 → 12.80 | 356.24 → 240.02 | 7,760.40 → 4,841.42 |
| SoupBackfill | 23.92 → 16.22 | 446.62 → 317.96 | 12,075.08 → 6,088.18 |
| SoupItemFields | 15.84 → 10.92 | 340.50 → 245.38 | 6,682.30 → 5,005.44 |
| SoupMailBackfill | 16.96 → 12.40 | 354.98 → 241.44 | 7,860.56 → 4,791.24 |
| SoupMembership | 1.10 → 1.12 | 11.68 → 9.28 | 202.78 → 113.20 |
| SoupNotifications | 8.76 → 6.30 | 189.06 → 120.38 | 3,941.10 → 2,094.50 |
| SoupSharedMailBackfill | 17.80 → 12.76 | 362.70 → 251.00 | 8,117.10 → 4,987.22 |

## Fresh targeted checks

A separate sequential native before/after run used five samples after two warmups at all three sizes, with the previous executable saved before changing production code.

| Operation | Size | Before p50 ms | After p50 ms | Speedup |
| --- | ---: | ---: | ---: | ---: |
| GroupSoup | 50 | 3.26 | 1.99 | 1.64× |
| GroupSoup | 1,000 | 227.25 | 89.58 | 2.54× |
| GroupSoup | 10,000 | 3136.02 | 1956.80 | 1.60× |
| GroupSoupMembership | 50 | 0.09 | 0.08 | 1.11× |
| GroupSoupMembership | 1,000 | 2.19 | 1.81 | 1.21× |
| GroupSoupMembership | 10,000 | 164.31 | 94.77 | 1.73× |

## Regression review

Review flags require a p50 increase above both 20% and an absolute floor of 5 microseconds for native or 100 microseconds for browsers. These thresholds identify rows to investigate; they are not statistical significance tests.

The historical comparison flagged the native 10,000-key `GraphqlChatQuickAccessName` read (17.49 → 21.73 ms). A fresh sequential before/after repeat with 50 samples and 10 warmups measured 18.36 → 17.43 ms; the slowdown did not reproduce.

Four Chromium 50-item rows initially rose by about 0.2 ms. In a fresh repeat of all 54 small cases using the saved before/after bundles, those four flags cleared or reversed. Different JSON cases moved upward (`MailAccounts` 0.3 → 0.5 ms and `ItemPreviews` 0.6 → 0.9 ms); their first comparisons were 0.5 → 0.4 ms and 0.6 → 0.6 ms. These sub-millisecond results vary with browser clocks and scheduling. Both complete repeats and all original slower rows are retained, and no claim is made that every individual case improves.

The Firefox 50-key `GraphqlProjectQuickAccessName` row rose from 1.64 to 1.98 ms. A fresh repeat of all 54 small cases measured 1.68 to 1.94 ms for that selection. This is a remaining small-read tradeoff of about 0.26 ms (15% in the repeat), not a cleared slowdown. No row in that fresh Firefox repeat crossed the diagnostic gate, and neither browser had flagged rows at 1,000 or 10,000 results. The original comparisons and complete repeats are retained.

A small-response `EmailThreadPage` hydration check used exactly 50 / 1,000 / 10,000 cached records, 20 samples/five warmups. Before p50 was 0.154 / 0.172 / 0.193 ms; after was 0.157 / 0.194 / 0.187 ms. This checks small cold reads separately from oversized results; the full 864-case population matrix was not rerun.

## Validation and limits

- 235 cache-core/Turso tests and 28 native host tests passed, including new branch-resumption, duplicate-selection, argument isolation, ordering, corruption and indexed-lookup cost regressions.
- Every measured browser/native selection passed a full result comparison before timing. Native test coverage also exercises optimistic layers, subscription invalidation, entity resolvers and durable storage recovery.
- `just check` and all five QC roles passed.
- The SQL cost regression checks a 128-key lookup against a 10,000-record table using VM-step counts, not flaky wall-clock assertions.

Sample counts match the baseline: native 20 samples/five warmups; browser 50/1,000 cases 30/five; browser 10,000 cases 10/two. A 10-sample p95 is the maximum observed sample. The machine is shared and browser clocks/scheduling limit small timing comparisons.

These are cache reads, excluding network fetching, UI rendering, live Tauri webview IPC, cold OS caches and peak heap measurement. Large nested outputs still incur record decoding, JSON allocation/serialization and browser messaging. GroupSoup size 10,000 means bins with two nested entries and 108,335 seeded records; EmailThreadPage has 60,003 seeded records. Fragment requests are bounded to 500 keys, so a 10,000-key row times 20 sequential calls. These stress responses exceed normal page sizes and the memory cache. No claim is made that every large response is now subsecond.

## Data and reproduction

- [All 486 before/after pairs, p50/p95 and speedups](results/scale-optimization.csv).
- [Raw before/after samples, fresh checks, browser/WASM hashes and exact run plan](results/scale-optimization-raw.json.gz).
- [Benchmark commands and fixture definitions](README.md#cache-population-versus-response-size).

Use the existing `compare.py before.json after.json --csv comparison.csv` on each matching report pair. Preserve the baseline executable and browser bundle before applying changes; export the fixtures once and use the same corpus for both versions.
