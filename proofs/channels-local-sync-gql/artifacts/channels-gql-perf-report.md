Latest-page GraphQL / REST performance proof

The optimized composed-schema benchmark completed successfully against the existing read-only `channels` database on localhost:22900. It selected every channel-message field, full thread metadata and three-reply previews, plus activity fields, for the latest 50 entries on the seeded 50,000-message channel. Both paths used the same real MessageService, PgMessageRepository, PgActivityRepo and warmed four-connection pool. The measured REST path called the same domain method as the REST handler and serialized its actual response DTO. GraphQL parsing, validation, dispatch, field resolution, mapping and response JSON serialization were included. Test-harness request-data setup was outside the timer.

The run alternated execution order for 20 warmup pairs and 200 measured pairs. Connections enforced `default_transaction_read_only=on` and `statement_timeout=15000`; no seed data or schema changed. A scoped tracing subscriber measured wall time from span creation to closure, including awaited I/O. SQL inventory probes ran after the timed samples and retained only statement templates, with no bind values.

| Optimized measurement | Median (ms) | p95 (ms) |
| --- | ---: | ---: |
| GraphQL total | 2.370 | 2.666 |
| REST total | 1.671 | 1.875 |
| GraphQL channel authorization (stubbed) | 0.001 | 0.002 |
| GraphQL sequence (temporary zero seam) | 0.000 | 0.001 |
| GraphQL real domain read | 1.581 | 1.814 |
| GraphQL mapping | 0.042 | 0.057 |
| GraphQL execution residual | 0.677 | 0.753 |
| GraphQL response JSON | 0.046 | 0.061 |
| REST real domain read | 1.590 | 1.780 |
| REST response JSON | 0.070 | 0.098 |

GraphQL adds 0.699 ms at the median (1.418x). The measured domain reads are essentially equal. The additional work is predominantly GraphQL execution/field resolution. Total time also includes object cleanup, and phase percentiles are not additive. This demonstrates small absolute overhead, not literal equal latency.

The identical phase-aware benchmark also passed in the unoptimized test profile:

| Unoptimized measurement | Median (ms) | p95 (ms) |
| --- | ---: | ---: |
| GraphQL total | 12.152 | 16.803 |
| REST total | 6.573 | 9.378 |
| GraphQL channel authorization (stubbed) | 0.024 | 0.036 |
| GraphQL sequence (temporary zero seam) | 0.004 | 0.005 |
| GraphQL real domain read | 5.211 | 7.007 |
| GraphQL mapping | 0.205 | 0.320 |
| GraphQL execution residual | 5.535 | 7.756 |
| GraphQL response JSON | 1.064 | 1.822 |
| REST real domain read | 5.107 | 7.156 |
| REST response JSON | 1.411 | 2.280 |

The unoptimized median delta is 5.579 ms (1.849x). Its SQL inventory is the same nine templates per path. The much smaller optimized delta shows why the unoptimized adapter cost should not be used as a production estimate.

Both paths issued exactly nine identical SQL statement templates (the logged template multisets were compared programmatically):

1. Channel existence lookup.
2. Activity timeline selection (concurrent with the root selection).
3. Root-message keyset selection.
4. Thread state, live-reply counts, and latest-reply times.
5. Three-reply previews.
6. Attachments, batched by message ID.
7. Reactions, batched by message ID.
8. Mentions, batched by message ID.
9. Bot profiles, batched by sender ID.

No calls or PDF highlights were present in this selected page; their conditional queries therefore did not execute. Exact statement templates and the complete optimized benchmark output are in `/tmp/channels-perf-release.log`.

Limits: authentication and channel access use the composed-schema test harness, so these numbers exclude production authorization queries and HTTP/network time. The sequence dependency was still the explicitly marked `seq: "0"` integration seam; its final database read is not measured. These are sequential warm-cache requests, not a load test. Before phase instrumentation, the initial unoptimized run measured GraphQL 10.205/11.904 ms median/p95 and REST 5.328/6.434 ms. The optimized measurements above establish the production-relevant adapter cost.

Reproduction: use the ignored test `schema::test::channel_perf::channel_latest_graphql_and_rest_server_timings` in `complete_graph`, with `SQLX_OFFLINE` unset, a live scratch-schema `DATABASE_URL` for compile-time SQLx checks, and `CHANNEL_PERF_DATABASE_URL` / `CHANNEL_PERF_CHANNEL_ID` for the existing read-only seed. The optimized run used `cargo test --release -p complete_graph --lib channel_latest_graphql_and_rest_server_timings -- --ignored --nocapture`, `CARGO_TARGET_DIR=target/channel-perf-release`, and a per-command empty `RUSTC_WRAPPER` after the shared compiler cache stalled during metadata discovery. The completed executable is `target/channel-perf-release/release/deps/complete_graph-43cfde49bb596720`.

The benchmark-only setup queries were explained on the seed: channel owner lookup scanned its 33-row channel table in 0.051 ms with one shared buffer hit; the read-only setting probe took 0.009 ms. Neither query runs inside the measured page operations. The hexagonal boundary is unchanged: production authorization stays in the existing access service, and both adapters use the same message domain service and repositories.
