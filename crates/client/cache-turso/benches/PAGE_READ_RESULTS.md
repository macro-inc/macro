# Reading 100–500 entries from a 10,000-record cache

**Every measured database contains exactly 10,000 normalized records, including the requested data. Each outer result collection contains 100, 250 or 500 entries; fragment reads request that many keys.** This measures the current implementation after the [read optimizations](SCALE_OPTIMIZATION_RESULTS.md); it is an absolute latency study, not another before/after comparison.

Run started 2026-09-26T23:40:38.841621+00:00, reported 2026-09-27T02:02:34.799300+00:00. AMD EPYC 9B45 shared Linux host; release native file-backed Turso and real Chromium/Firefox worker/WASM/OPFS. Runs were sequential and pinned to CPUs 0–3. Production worker/WASM assets match the optimized scale run byte-for-byte. Completed Chromium runs used the original harness; Firefox used a one-line harness guard to skip setup of the excluded pressure scenario. The timed warm/hydration paths are identical, and both bundle hashes and the guard are preserved in the raw artifact.

## What is timed

- **Warm:** the selected records are already in the normal 10,000-record memory tier. The durable database still contains 10,000 records. The full selected response is assembled for every read; there is no response memoization.
- **Turso hydration:** selected fixture records are evicted from the memory tier before each timed read, leaving the durable records intact. Timing includes loading the required records from Turso and assembling the result. Eviction, fixture seeding and correctness checks are outside timing. Browser preparation uses the normal invalidation API, including auxiliary projection updates; their cost is also excluded. OS caches and operation parsing remain warm.
- Browser timings include coordinator/worker messaging, WASM conversions and OPFS access when hydration is needed. Network fetching, UI rendering and application startup are excluded.
- All 22 production queries and 10 fragment selections are covered at all three sizes: **576 distributions, 30 samples after five warmups each, 17,280 timed reads**. Every measured read is one API call; fragment sizes stay within the 500-key limit.

The population is 10,000 **normalized records**, not 10,000 complete documents or email threads plus their related objects. Requested records are included in that total; synthetic document metadata with disjoint IDs fills the remainder. Query pages are pre-cached under their actual variables, and fragment reads request the selected entity keys; this measures reading a cached selection, not constructing server-side pages or fetching a cache miss. GroupSoup sizes count bins, each with two nested items; other nested collections also contain two entries. If an operation has multiple outer lists, the size applies to each: MyActivityOverview has both `days` and `topEntities` lists of that size. These are synthetic production selection shapes, not a traffic-weighted dataset.

## Across operations

Values are the **unweighted median of the 32 per-operation p50 timings, in milliseconds**. Each operation has equal weight; these are not production traffic averages or aggregate p95 estimates.

| Host | Read state | 100 returned | 250 returned | 500 returned |
| --- | --- | ---: | ---: | ---: |
| native | Warm | 0.166 | 0.419 | 0.875 |
| native | Turso hydration | 0.727 | 1.896 | 3.587 |
| chromium | Warm | 0.900 | 2.050 | 3.700 |
| chromium | Turso hydration | 2.250 | 5.100 | 7.950 |
| firefox | Warm | 3.790 | 8.940 | 17.410 |
| firefox | Turso hydration | 9.150 | 20.060 | 38.520 |

## Representative query timings

Cells are **p50 / p95 milliseconds**. Each row uses the same 10,000-record database population.

| Query | Returned size | State | Native | Chromium | Firefox |
| --- | ---: | --- | ---: | ---: | ---: |
| ChannelListSoup | 100 | Warm | 0.96 / 1.28 | 4.10 / 5.10 | 13.86 / 21.66 |
| ChannelListSoup | 100 | Turso | 3.18 / 3.72 | 7.30 / 8.70 | 31.62 / 37.00 |
| ChannelListSoup | 250 | Warm | 2.29 / 2.93 | 8.70 / 13.60 | 29.52 / 35.82 |
| ChannelListSoup | 250 | Turso | 7.14 / 9.52 | 16.10 / 20.10 | 66.84 / 72.62 |
| ChannelListSoup | 500 | Warm | 5.13 / 6.61 | 16.80 / 23.30 | 58.46 / 67.16 |
| ChannelListSoup | 500 | Turso | 15.66 / 18.67 | 30.70 / 35.70 | 130.92 / 145.72 |
| EmailThreadPage | 100 | Warm | 1.81 / 2.27 | 12.90 / 15.90 | 40.70 / 48.36 |
| EmailThreadPage | 100 | Turso | 6.12 / 8.22 | 17.70 / 20.00 | 72.36 / 85.00 |
| EmailThreadPage | 250 | Warm | 7.81 / 10.70 | 32.50 / 37.70 | 114.14 / 131.26 |
| EmailThreadPage | 250 | Turso | 20.56 / 27.78 | 43.90 / 49.40 | 195.64 / 223.48 |
| EmailThreadPage | 500 | Warm | 19.95 / 22.82 | 67.10 / 89.90 | 237.38 / 283.34 |
| EmailThreadPage | 500 | Turso | 38.22 / 45.13 | 90.00 / 109.00 | 365.72 / 428.50 |
| Soup | 100 | Warm | 1.78 / 2.00 | 5.80 / 9.70 | 22.54 / 34.68 |
| Soup | 100 | Turso | 5.73 / 6.73 | 11.70 / 13.70 | 50.50 / 58.50 |
| Soup | 250 | Warm | 6.21 / 9.73 | 16.60 / 20.60 | 60.68 / 69.68 |
| Soup | 250 | Turso | 14.59 / 19.87 | 27.90 / 33.80 | 112.24 / 130.92 |
| Soup | 500 | Warm | 13.67 / 18.84 | 34.50 / 43.80 | 126.46 / 162.50 |
| Soup | 500 | Turso | 29.74 / 37.34 | 54.50 / 61.20 | 212.40 / 237.56 |
| SoupBackfill | 100 | Warm | 2.07 / 2.24 | 8.80 / 11.20 | 32.92 / 45.22 |
| SoupBackfill | 100 | Turso | 6.34 / 6.91 | 13.80 / 16.60 | 59.98 / 69.32 |
| SoupBackfill | 250 | Warm | 7.45 / 10.28 | 22.30 / 29.40 | 77.24 / 93.40 |
| SoupBackfill | 250 | Turso | 21.54 / 27.73 | 34.00 / 40.60 | 145.00 / 157.74 |
| SoupBackfill | 500 | Warm | 19.55 / 23.64 | 44.50 / 52.80 | 159.04 / 193.12 |
| SoupBackfill | 500 | Turso | 43.58 / 48.70 | 68.50 / 80.90 | 282.56 / 319.62 |
| GroupSoup | 100 | Warm | 3.45 / 4.22 | 12.20 / 16.40 | 45.22 / 56.26 |
| GroupSoup | 100 | Turso | 10.94 / 12.65 | 19.70 / 24.40 | 86.04 / 92.64 |
| GroupSoup | 250 | Warm | 13.26 / 14.84 | 32.70 / 46.00 | 107.20 / 119.58 |
| GroupSoup | 250 | Turso | 27.90 / 34.90 | 51.90 / 65.70 | 202.68 / 218.02 |
| GroupSoup | 500 | Warm | 37.70 / 51.81 | 68.10 / 74.40 | 227.14 / 269.84 |
| GroupSoup | 500 | Turso | 58.55 / 81.97 | 109.70 / 129.60 | 399.30 / 419.04 |

## Every operation

Cells are **warm p50 / Turso-hydration p50 milliseconds**. Full p95 values and all samples are linked below.

### native

| Operation | Kind | 100 returned | 250 returned | 500 returned |
| --- | --- | ---: | ---: | ---: |
| AgentSessionMentions | query | 0.062 / 0.561 | 0.147 / 1.278 | 0.429 / 2.144 |
| ChannelListItemFields | fragment | 0.943 / 2.791 | 2.262 / 6.422 | 5.029 / 15.011 |
| ChannelListSoup | query | 0.956 / 3.178 | 2.288 / 7.135 | 5.134 / 15.662 |
| ChannelUnreadPresence | query | 0.065 / 0.615 | 0.195 / 1.280 | 0.314 / 2.337 |
| EmailThreadMessageFields | fragment | 1.928 / 6.753 | 8.922 / 19.460 | 19.043 / 34.530 |
| EmailThreadPage | query | 1.812 / 6.125 | 7.807 / 20.555 | 19.951 / 38.215 |
| EntityActivity | query | 0.371 / 1.720 | 0.943 / 3.781 | 2.006 / 8.086 |
| EntityProperties | query | 0.582 / 1.863 | 1.095 / 4.025 | 2.748 / 9.516 |
| Favorites | query | 0.176 / 0.651 | 0.325 / 1.514 | 0.692 / 2.672 |
| GraphqlChannelQuickAccessFields | fragment | 0.231 / 0.741 | 0.609 / 2.042 | 1.236 / 4.292 |
| GraphqlChatQuickAccessName | fragment | 0.108 / 0.485 | 0.300 / 1.252 | 0.656 / 2.305 |
| GraphqlCrmCompanyQuickAccessFields | fragment | 0.155 / 0.591 | 0.450 / 1.738 | 0.939 / 3.150 |
| GraphqlDocumentQuickAccessName | fragment | 0.135 / 0.565 | 0.387 / 1.387 | 0.810 / 2.590 |
| GraphqlProjectQuickAccessName | fragment | 0.107 / 0.479 | 0.300 / 1.260 | 0.642 / 2.307 |
| GroupSoup | query | 3.450 / 10.939 | 13.257 / 27.898 | 37.696 / 58.552 |
| GroupSoupMembership | query | 0.146 / 1.047 | 0.388 / 2.184 | 0.798 / 4.023 |
| ItemPreview | query | 0.087 / 0.535 | 0.204 / 1.303 | 0.424 / 2.234 |
| ItemPreviewFields | fragment | 0.133 / 0.547 | 0.361 / 1.366 | 0.799 / 2.652 |
| ItemPreviewFileTypeCacheWrite | query | 0.054 / 0.501 | 0.126 / 1.742 | 0.260 / 1.948 |
| ItemPreviewNameCacheWrite | query | 0.073 / 0.511 | 0.166 / 1.286 | 0.343 / 2.056 |
| ItemPreviews | query | 0.130 / 0.713 | 0.324 / 1.749 | 0.628 / 2.895 |
| MailAccounts | query | 0.061 / 0.489 | 0.216 / 1.689 | 0.315 / 1.956 |
| MailItemFields | fragment | 1.847 / 4.974 | 5.889 / 15.906 | 16.523 / 29.578 |
| MyActivity | query | 0.142 / 0.641 | 0.371 / 1.452 | 0.758 / 2.931 |
| MyActivityOverview | query | 0.078 / 0.242 | 0.194 / 0.394 | 0.406 / 0.750 |
| Soup | query | 1.776 / 5.726 | 6.211 / 14.591 | 13.671 / 29.745 |
| SoupBackfill | query | 2.073 / 6.337 | 7.446 / 21.540 | 19.546 / 43.580 |
| SoupItemFields | fragment | 1.794 / 4.767 | 5.423 / 13.553 | 17.710 / 30.388 |
| SoupMailBackfill | query | 1.738 / 5.234 | 4.230 / 13.045 | 14.479 / 31.097 |
| SoupMembership | query | 0.064 / 0.466 | 0.115 / 1.103 | 0.249 / 1.926 |
| SoupNotifications | query | 0.836 / 2.587 | 2.054 / 6.020 | 4.797 / 13.480 |
| SoupSharedMailBackfill | query | 1.824 / 5.260 | 4.630 / 14.276 | 17.152 / 30.342 |

### chromium

| Operation | Kind | 100 returned | 250 returned | 500 returned |
| --- | --- | ---: | ---: | ---: |
| AgentSessionMentions | query | 0.500 / 2.100 | 0.800 / 2.600 | 1.300 / 4.600 |
| ChannelListItemFields | fragment | 3.100 / 6.500 | 9.900 / 14.500 | 15.400 / 27.400 |
| ChannelListSoup | query | 4.100 / 7.300 | 8.700 / 16.100 | 16.800 / 30.700 |
| ChannelUnreadPresence | query | 0.500 / 1.800 | 0.800 / 2.900 | 1.700 / 5.100 |
| EmailThreadMessageFields | fragment | 11.700 / 17.400 | 33.200 / 41.200 | 67.400 / 84.700 |
| EmailThreadPage | query | 12.900 / 17.700 | 32.500 / 43.900 | 67.100 / 90.000 |
| EntityActivity | query | 1.700 / 3.900 | 3.600 / 8.100 | 7.400 / 16.000 |
| EntityProperties | query | 2.000 / 4.400 | 4.000 / 9.300 | 8.200 / 18.100 |
| Favorites | query | 0.700 / 1.600 | 1.200 / 3.300 | 2.200 / 5.500 |
| GraphqlChannelQuickAccessFields | fragment | 1.000 / 2.400 | 2.400 / 5.000 | 5.000 / 9.000 |
| GraphqlChatQuickAccessName | fragment | 0.700 / 1.600 | 1.700 / 4.100 | 2.500 / 6.100 |
| GraphqlCrmCompanyQuickAccessFields | fragment | 0.900 / 1.700 | 2.000 / 3.900 | 3.900 / 7.200 |
| GraphqlDocumentQuickAccessName | fragment | 0.900 / 1.900 | 2.000 / 4.000 | 3.400 / 7.000 |
| GraphqlProjectQuickAccessName | fragment | 0.700 / 2.000 | 1.500 / 4.000 | 3.100 / 6.300 |
| GroupSoup | query | 12.200 / 19.700 | 32.700 / 51.900 | 68.100 / 109.700 |
| GroupSoupMembership | query | 0.700 / 2.300 | 2.100 / 5.400 | 3.500 / 8.700 |
| ItemPreview | query | 0.500 / 1.800 | 1.100 / 3.600 | 2.100 / 6.200 |
| ItemPreviewFields | fragment | 0.800 / 1.800 | 1.700 / 5.200 | 3.500 / 6.400 |
| ItemPreviewFileTypeCacheWrite | query | 0.400 / 1.800 | 0.700 / 2.600 | 1.300 / 4.700 |
| ItemPreviewNameCacheWrite | query | 0.400 / 1.700 | 0.900 / 2.700 | 1.400 / 5.000 |
| ItemPreviews | query | 0.700 / 2.200 | 1.400 / 4.200 | 2.400 / 6.500 |
| MailAccounts | query | 0.400 / 1.400 | 0.900 / 2.500 | 1.400 / 4.300 |
| MailItemFields | fragment | 6.400 / 10.800 | 18.000 / 24.700 | 32.700 / 51.300 |
| MyActivity | query | 0.700 / 1.900 | 1.500 / 3.300 | 2.700 / 6.700 |
| MyActivityOverview | query | 0.600 / 1.000 | 0.900 / 1.400 | 1.900 / 2.400 |
| Soup | query | 5.800 / 11.700 | 16.600 / 27.900 | 34.500 / 54.500 |
| SoupBackfill | query | 8.800 / 13.800 | 22.300 / 34.000 | 44.500 / 68.500 |
| SoupItemFields | fragment | 6.200 / 11.200 | 15.200 / 25.900 | 33.600 / 49.100 |
| SoupMailBackfill | query | 6.500 / 11.300 | 16.300 / 26.100 | 31.900 / 56.900 |
| SoupMembership | query | 0.500 / 1.700 | 0.600 / 3.000 | 1.300 / 4.500 |
| SoupNotifications | query | 2.500 / 5.700 | 6.800 / 13.500 | 13.800 / 23.100 |
| SoupSharedMailBackfill | query | 6.000 / 11.000 | 16.000 / 26.700 | 33.300 / 55.300 |

### firefox

| Operation | Kind | 100 returned | 250 returned | 500 returned |
| --- | --- | ---: | ---: | ---: |
| AgentSessionMentions | query | 1.700 / 7.400 | 3.300 / 14.080 | 5.600 / 22.660 |
| ChannelListItemFields | fragment | 15.420 / 26.880 | 29.660 / 61.540 | 60.440 / 120.080 |
| ChannelListSoup | query | 13.860 / 31.620 | 29.520 / 66.840 | 58.460 / 130.920 |
| ChannelUnreadPresence | query | 1.620 / 7.460 | 3.300 / 13.860 | 5.140 / 23.540 |
| EmailThreadMessageFields | fragment | 39.640 / 67.740 | 103.900 / 168.100 | 230.060 / 353.160 |
| EmailThreadPage | query | 40.700 / 72.360 | 114.140 / 195.640 | 237.380 / 365.720 |
| EntityActivity | query | 6.100 / 17.400 | 15.940 / 41.260 | 28.340 / 78.080 |
| EntityProperties | query | 6.800 / 19.700 | 17.620 / 41.160 | 29.120 / 79.480 |
| Favorites | query | 2.480 / 6.880 | 5.640 / 15.320 | 13.080 / 26.980 |
| GraphqlChannelQuickAccessFields | fragment | 4.420 / 9.600 | 10.840 / 21.040 | 22.540 / 42.840 |
| GraphqlChatQuickAccessName | fragment | 2.620 / 7.200 | 6.540 / 16.880 | 15.100 / 31.400 |
| GraphqlCrmCompanyQuickAccessFields | fragment | 4.680 / 7.680 | 9.360 / 18.380 | 18.380 / 36.640 |
| GraphqlDocumentQuickAccessName | fragment | 2.960 / 7.740 | 7.600 / 19.080 | 16.440 / 35.380 |
| GraphqlProjectQuickAccessName | fragment | 2.820 / 7.240 | 6.960 / 17.160 | 14.340 / 33.840 |
| GroupSoup | query | 45.220 / 86.040 | 107.200 / 202.680 | 227.140 / 399.300 |
| GroupSoupMembership | query | 3.160 / 11.020 | 8.520 / 21.760 | 13.840 / 40.400 |
| ItemPreview | query | 1.880 / 6.800 | 3.680 / 13.180 | 6.740 / 22.540 |
| ItemPreviewFields | fragment | 2.880 / 6.820 | 7.740 / 15.520 | 13.460 / 30.720 |
| ItemPreviewFileTypeCacheWrite | query | 1.480 / 6.740 | 3.100 / 11.540 | 4.600 / 19.920 |
| ItemPreviewNameCacheWrite | query | 1.620 / 7.020 | 3.320 / 13.040 | 7.280 / 21.540 |
| ItemPreviews | query | 2.760 / 8.700 | 5.440 / 16.820 | 9.760 / 29.020 |
| MailAccounts | query | 1.740 / 5.920 | 3.760 / 11.760 | 6.540 / 21.860 |
| MailItemFields | fragment | 21.220 / 42.320 | 58.660 / 104.440 | 119.300 / 213.400 |
| MyActivity | query | 2.620 / 7.880 | 5.900 / 14.780 | 12.460 / 28.440 |
| MyActivityOverview | query | 1.820 / 3.080 | 3.540 / 5.380 | 5.780 / 8.480 |
| Soup | query | 22.540 / 50.500 | 60.680 / 112.240 | 126.460 / 212.400 |
| SoupBackfill | query | 32.920 / 59.980 | 77.240 / 145.000 | 159.040 / 282.560 |
| SoupItemFields | fragment | 22.880 / 43.280 | 55.960 / 105.400 | 118.520 / 212.280 |
| SoupMailBackfill | query | 23.560 / 49.060 | 59.900 / 112.940 | 125.380 / 213.780 |
| SoupMembership | query | 1.400 / 6.520 | 2.820 / 12.060 | 4.840 / 20.220 |
| SoupNotifications | query | 11.320 / 24.360 | 28.160 / 53.820 | 57.720 / 105.260 |
| SoupSharedMailBackfill | query | 22.960 / 50.060 | 59.640 / 118.140 | 124.000 / 231.120 |

## Population and validation

Examples at returned size 500 (browser fixture counts):

| Query | Requested fixture records | Background records | Total records |
| --- | ---: | ---: | ---: |
| ChannelListSoup | 2,288 | 7,712 | 10,000 |
| EmailThreadPage | 3,003 | 6,997 | 10,000 |
| Soup | 3,204 | 6,796 | 10,000 |
| GroupSoup | 5,426 | 4,574 | 10,000 |

Fixture export asserts the exact normalized-key union. Native setup verifies every durable key through Turso; browser setup closes/reopens OPFS, verifies all background identities and compares the complete selected result before timing. All rows were checked for operation/size/scenario coverage, a 10,000-record population and memory capacity, one call per read, 30 sorted samples and correctly calculated p50/p95 values. No production code changed for this study. The benchmark-only setup guard passed scoped TypeScript checking, browser smoke checks with pressure included and excluded, and `just check`.

Email fixtures include 5 KB body fields, so a 500-message page carries megabytes of data. GroupSoup at size 500 returns 500 bins and 1,000 nested items; read its timings accordingly. Fixture-record counts include related entities and any seeding scaffold, and are not necessarily the exact number visited by the selection.

Measurements share a host with other workloads. Browser clock resolution and scheduling affect small timings; 30 samples give an indicative p95, not a production tail guarantee. This study does not cover cold OS caches, memory pressure beyond the normal cache capacity, concurrent requests, live Tauri webview IPC or peak heap usage.

## Data and reproduction

- [Every measured row, p50/p95, population and fixture counts](results/page-read-10k.csv).
- [Raw samples, fixture manifest, native artifact hash, browser/WASM hashes and exact run plan](results/page-read-10k-raw.json.gz).
- [Benchmark harness and fixture definitions](README.md#cache-population-versus-response-size).

From the repository root, build and run the native suite and export the browser fixtures:

```sh
nix develop --command cargo bench --locked -p cache-turso --bench graphql_queries -- \
  --disk --sizes 100,250,500 --variants 1 --cache-records 10000 \
  --samples 30 --warmup 5 --scenarios population-hot,population-hydrate \
  --output /tmp/page-native.json
nix develop --command cargo bench --locked -p cache-turso --bench graphql_queries -- \
  --sizes 100,250,500 --variants 1 --cache-records 10000 \
  --export-browser /tmp/page-fixtures
```

Build the browser harness using the README, then run from `apps/web` in the Bun/Nix environment. Repeat with `--browser firefox`; run hosts sequentially after builds finish.

```sh
bun scripts/cache-wasm/benchmark-queries.ts --browser chromium \
  --fixtures /tmp/page-fixtures --sizes 100,250,500 --variants 1 \
  --cache-records 10000 --samples 30 --warmup 5 --cold-samples 0 \
  --scenarios population-hot,population-hydrate --output /tmp/page-chromium.json
```
