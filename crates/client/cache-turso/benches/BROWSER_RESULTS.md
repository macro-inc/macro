# Browser Turso cache performance results

For independent **50 / 1,000 / 10,000 cache-record populations** and returned
results up to 10,000 items, see the [scale results](SCALE_RESULTS.md). The fixture
sizes in this earlier comparison describe response shape, not total cache size.

Reference run: 2026-09-26, Linux x86_64 on an AMD EPYC 9B45 shared virtual machine. Browser processes were pinned to CPUs 0–3 and measurements ran sequentially after builds and tests. These are deterministic synthetic workloads, not production traffic or device latency guarantees.

Baseline production code: `ea7a41f9fd8a9106b839fad3695aac06ccb6244a`. Both versions used identical benchmark code, fixture files and options; the optimized build contains the shared Rust cache improvements, exact JSON float parsing, bulk JSON read-response conversion and browser coordinator lifecycle fix in this change. Browser writes, reads, messaging, WASM conversions and OPFS use the real production implementations.

## Coverage

All **22 production queries and 10 fragment selections** were exercised in Chromium and Firefox. Selection documents are discovered from production sources, schema-validated and checked for exact round trips before timing. Sizes count outer collection entries or fragment keys; nested collections contain two entries. Grouped-query sizes count bins. Queries without collections do not grow just because the requested size grows.

| Matrix | Sizes | Chromium variants | Firefox variants | Samples / warmup | Chromium paired rows | Firefox paired rows |
| --- | --- | --- | --- | --- | ---: | ---: |
| Standard | 1, 50 | 8, 32 | 8 | 30 / 5 | 552 | 276 |
| Large | 250 | 8 | 8 | 20 / 5 | 256 | 138 |
| Reconnect diagnostic | 1 | 8 | 8 | 5 / 5; 3 reopen samples | 2 | 2 |

Chromium runs the full warm scenario matrix. Firefox cross-checks every operation with `hot-resolvers,hot-json,records-hot,records-json,variants-8,capacity-16,miss`; it does not duplicate Chromium’s write, general concurrency or forced-plan-parse matrix. The standard and large matrices set `--cold-samples 0`. Cold startup is measured separately because the original coordinator can wait 60 seconds on reconnection. Each optimized browser additionally completes all 32 operations at sizes 1 and 50 with three reopen samples each (64 cold distributions per browser). The focused before/after reconnect case runs `AgentSessionMentions` after an eight-client wave.

Complete per-scenario p50/p95 measurements, including slower rows:

- Chromium: [standard](results/browser-chromium-standard.csv), [large](results/browser-chromium-large.csv), [reconnect](results/browser-chromium-reconnect.csv), [optimized cold reads](results/browser-chromium-cold-after.csv).
- Firefox: [standard](results/browser-firefox-standard.csv), [large](results/browser-firefox-large.csv), [reconnect](results/browser-firefox-reconnect.csv), [optimized cold reads](results/browser-firefox-cold-after.csv).
- [Compressed raw reports](results/browser-raw.json.gz) include all sorted samples, options, inventory, schema/corpus/bundle/WASM hashes and the final native confirmation.

## Fixes and measured effects

The shared Rust changes remove whole-record cloning from denormalization and hot fragment batches, reuse bounded query and fragment plans, skip unchanged reverse-dependency rebuilding, and refresh hot dependencies before cold promotion. Fragment plans now live in the shared core and benefit both native and browser hosts. Browser query and fragment read envelopes use bulk JSON conversion instead of crossing the WASM/JavaScript boundary for each field. Nested integers outside JavaScript’s safe range still use the original serializer and retain its rejection behavior; large floating-point values, negative zero and revision strings preserve their existing semantics.

| Median per-operation p50 speedup | Chromium | Firefox |
| --- | ---: | ---: |
| Registered reads, size 50 | 1.41× | 1.22× |
| 8 argument variants, size 50 | 1.67× | 1.23× |
| 32 argument variants, size 50 | 1.61× | not measured |
| Fragment reads, size 50 | 2.00× | 1.47× |
| Registered reads, size 250 | 1.78× | 1.38× |
| Fragment reads, size 250 | 1.46× | 1.39× |

The browser coordinator previously used one Effect runner scope for the whole SharedWorker. Closing its last client could close the SharedWorker while another client reconnected, leaving registration waiting for its 60-second timeout. Each client now owns a separate runner scope, with one shared router. Peer retirement and router-initiated liveness loss both clean up that client’s listeners/fibers; other clients remain usable.

| Reopen after client retirement | Before p50 / p95 (ms) | After p50 / p95 (ms) |
| --- | ---: | ---: |
| Chromium | 271.20 / 274.80 | 233.90 / 236.90 |
| Firefox | 60265.80 / 60282.82 | 239.40 / 243.24 |

Opaque JSON round trips also exposed a correctness bug: the baseline changed `15588948318755801000` to `15588948318755800000` when reparsing a JSON scalar. Enabling serde_json’s `float_roundtrip` feature preserves the original floating-point value. The regression fails on the original real browser worker and passes on the optimized one; a shared-engine test covers hot and cold reads. Performance fixtures keep synthetic integer seeds within JavaScript’s exact range so both implementations can pass the same performance checks.

## Per-operation reads

Standard matrix, size 50. Query rows use `hot-resolvers`; fragment rows use `records-hot`. Times are milliseconds. Full p95 values for both versions and all scenarios are in the CSVs.

### Queries

| Operation | Chromium p50 before → after | Chromium after p95 | Speedup | Firefox p50 before → after | Firefox after p95 | Speedup |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| AgentSessionMentions | 0.50 → 0.40 | 1.00 | 1.25× | 1.52 → 1.56 | 4.32 | 0.97× |
| ChannelListSoup | 3.20 → 2.30 | 3.80 | 1.39× | 11.28 → 8.44 | 10.26 | 1.34× |
| ChannelUnreadPresence | 0.80 → 0.40 | 2.70 | 2.00× | 1.36 → 1.18 | 1.42 | 1.15× |
| EmailThreadPage | 9.20 → 6.00 | 11.20 | 1.53× | 45.82 → 25.72 | 34.32 | 1.78× |
| EntityActivity | 1.70 → 1.20 | 3.40 | 1.42× | 5.40 → 4.36 | 6.44 | 1.24× |
| EntityProperties | 1.70 → 1.30 | 2.80 | 1.31× | 5.96 → 4.78 | 6.08 | 1.25× |
| Favorites | 0.80 → 0.50 | 3.30 | 1.60× | 2.24 → 1.86 | 2.08 | 1.20× |
| GroupSoup | 12.50 → 6.80 | 8.30 | 1.84× | 43.42 → 33.40 | 38.48 | 1.30× |
| GroupSoupMembership | 1.30 → 0.80 | 3.20 | 1.63× | 2.20 → 1.92 | 3.74 | 1.15× |
| ItemPreview | 0.70 → 0.50 | 1.00 | 1.40× | 1.84 → 1.40 | 2.12 | 1.31× |
| ItemPreviewFileTypeCacheWrite | 0.60 → 0.50 | 4.10 | 1.20× | 1.26 → 1.16 | 1.64 | 1.09× |
| ItemPreviewNameCacheWrite | 0.60 → 0.70 | 5.70 | 0.86× | 1.56 → 1.36 | 1.64 | 1.15× |
| ItemPreviews | 0.80 → 0.50 | 1.30 | 1.60× | 3.10 → 1.90 | 2.64 | 1.63× |
| MailAccounts | 0.50 → 0.40 | 1.10 | 1.25× | 1.40 → 1.06 | 1.58 | 1.32× |
| MyActivity | 0.90 → 0.60 | 1.40 | 1.50× | 2.50 → 2.08 | 2.82 | 1.20× |
| MyActivityOverview | 0.60 → 0.40 | 0.80 | 1.50× | 1.60 → 1.38 | 1.96 | 1.16× |
| Soup | 6.60 → 3.60 | 5.10 | 1.83× | 22.32 → 17.40 | 23.54 | 1.28× |
| SoupBackfill | 7.60 → 5.40 | 8.90 | 1.41× | 28.68 → 22.58 | 31.40 | 1.27× |
| SoupMailBackfill | 6.50 → 4.80 | 5.90 | 1.35× | 23.48 → 19.30 | 24.20 | 1.22× |
| SoupMembership | 0.50 → 0.50 | 3.40 | 1.00× | 1.20 → 1.22 | 1.48 | 0.98× |
| SoupNotifications | 2.90 → 1.80 | 3.00 | 1.61× | 11.78 → 9.92 | 12.78 | 1.19× |
| SoupSharedMailBackfill | 6.60 → 5.60 | 11.10 | 1.18× | 21.72 → 17.62 | 24.42 | 1.23× |

### Fragments

| Operation | Chromium p50 before → after | Chromium after p95 | Speedup | Firefox p50 before → after | Firefox after p95 | Speedup |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ChannelListItemFields | 5.20 → 2.30 | 4.90 | 2.26× | 15.20 → 8.00 | 11.22 | 1.90× |
| EmailThreadMessageFields | 9.80 → 6.80 | 14.70 | 1.44× | 38.74 → 26.14 | 29.50 | 1.48× |
| GraphqlChannelQuickAccessFields | 1.80 → 0.90 | 2.40 | 2.00× | 3.88 → 2.70 | 3.28 | 1.44× |
| GraphqlChatQuickAccessName | 0.90 → 0.60 | 2.70 | 1.50× | 2.12 → 2.10 | 2.88 | 1.01× |
| GraphqlCrmCompanyQuickAccessFields | 1.30 → 0.70 | 1.60 | 1.86× | 2.84 → 1.96 | 2.54 | 1.45× |
| GraphqlDocumentQuickAccessName | 1.40 → 0.60 | 2.40 | 2.33× | 2.50 → 1.92 | 2.88 | 1.30× |
| GraphqlProjectQuickAccessName | 1.00 → 0.50 | 1.70 | 2.00× | 2.14 → 1.52 | 1.98 | 1.41× |
| ItemPreviewFields | 1.10 → 0.60 | 2.50 | 1.83× | 3.98 → 1.74 | 2.52 | 2.29× |
| MailItemFields | 9.10 → 4.30 | 11.20 | 2.12× | 31.58 → 14.80 | 22.42 | 2.13× |
| SoupItemFields | 9.30 → 4.60 | 6.60 | 2.02× | 30.26 → 14.82 | 19.62 | 2.04× |

## Reproduction and measurement limits

Follow [the benchmark instructions](README.md). Export `--sizes 1,50,250 --variants 8,32`, build each version’s production WASM/JavaScript into separate saved bundles, and run the matrix options above. Standard and large use `--cold-samples 0`; Firefox additionally uses `--variants 8 --scenarios hot-resolvers,hot-json,records-hot,records-json,variants-8,capacity-16,miss`. The reconnect comparison uses `--filter AgentSessionMentions --sizes 1 --variants 8 --samples 5 --warmup 5 --cold-samples 3 --scenarios concurrent-8-total,reopen-first-read`. Optimized full cold coverage uses `--sizes 1,50 --variants 8 --samples 1 --warmup 5 --cold-samples 3 --scenarios reopen-first-read`.

Browser cold setup waits for database ownership and retired-client liveness locks to release. The timed first read includes engine-worker startup, WASM initialization, opening an existing OPFS database and reading it; it does not flush filesystem caches. `concurrent-8-total` is whole-wave latency, not individual-request p95. JSON scenarios include page-side serialization. No real user data or hosted backend is used.

Firefox’s temporary benchmark profile disables `privacy.reduceTimerPrecision` so sub-millisecond requests do not round to zero; application settings are unchanged. Chromium uses its default precision. Browser messaging, object conversion, serialization, durable writes, worker startup and low-capacity hydration remain material costs, so shared-engine speedups do not translate directly into equal end-to-end browser speedups. Bulk conversion allocates an intermediate JSON string; these latency benchmarks do not measure peak heap usage.

| Browser | Version | Timer resolution (µs) | Cross-origin isolated |
| --- | --- | ---: | --- |
| Chromium | 149.0.7827.55 | 100 | False |
| Firefox | 151.0 | 20 | False |

Speedup summaries are unweighted medians of per-operation p50 ratios, not traffic-weighted application speedups. These Linux Chromium/Firefox runs do not measure Safari, mobile devices, rendering, network GraphQL fetches or live Tauri webview IPC. Small browser changes near timer granularity should not be treated as precise speedup estimates. Reopen p95 is the maximum of only three samples and demonstrates the retry failure rather than a stable tail-latency estimate.

## Native confirmation and validation

The earlier [native results](RESULTS.md) retain their original measurements. A final core/Turso comparison with the exact-float parser and shared fragment-cache changes uses `--sizes 50 --variants 8 --samples 30 --warmup 5`. Across its 216 paired rows, the median per-operation p50 speedups are 1.41× for registered reads with resolvers, 1.51× for eight argument variants and 1.32× for fragment reads; see [all paired rows](results/final-core.csv) and the compressed raw reports.

## Regression checks

Of the 1,222 warm browser rows, 23 initially became slower by both more than 20% and more than 200 µs: 12 in Chromium and 11 in Firefox. All 23 were repeated with 100 samples and 20 warmups, pinned to CPUs 0–3, alternating before/after order across the 18 operation/size groups. Each pair used the same narrowed manifest and unchanged fixture files. None exceeded both thresholds on repeat. For example, Firefox's size-50 `SoupMailBackfill` empty-cache read initially went from 1.34 to 5.02 ms; the repeat measured 1.26 ms for both versions. [Browser repeat measurements](results/browser-repeats.csv) preserve the original values beside the repeats, and the raw archive includes their samples, metadata and repeat plan.

The final native confirmation initially flagged two `unchanged-write` rows at the stricter native threshold of more than 20% and more than 5 µs. Three further pairs for each operation used 300 samples, 50 warmups, eight variants and CPU 0, alternating execution order. `ItemPreviewNameCacheWrite` measured 108.17 → 104.44, 104.40 → 103.43 and 103.69 → 102.34 µs; `MyActivityOverview` measured 89.95 → 89.52, 89.88 → 89.09 and 89.46 → 90.28 µs. Neither flagged write regression reproduced. [All native repeat rows](results/final-core-repeats.csv) and their raw samples are retained.

These focused checks did not reproduce the originally flagged regressions. They do not establish that every scenario improves or provide production latency guarantees; the main CSVs retain all slower measurements.

## Validation

Validation passed: 228 core/Turso tests, 28 native-host tests, 25 cache-WASM tests inside a real Chromium dedicated worker, 457 GraphQL-cache frontend tests, the scoped TypeScript check and `just check`. All five QC review roles passed. Architecture boundaries were checked: generic cache/storage work stays in the client crates; authorization and business policy remain in their domain services.
