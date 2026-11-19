Real-sequence channel GraphQL performance proof

All three optimized benchmark invocations passed and returned `seq: "1"` from the real message-service counter read. Each invocation used 20 warmup pairs and 200 measured pairs, alternated GraphQL/REST execution order, and selected the latest 50 entries with every message field, thread metadata, previews, and activity fields. No application caching was added.

| Invocation | GraphQL median / p95 (ms) | REST median / p95 (ms) | Median difference (ms) |
| --- | ---: | ---: | ---: |
| Initial after compilation | 3.158 / 10.901 | 2.048 / 6.002 | +1.110 |
| No-build repeat 1 | 2.261 / 2.557 | 1.391 / 1.708 | +0.870 |
| No-build repeat 2 | 2.217 / 2.879 | 1.400 / 1.900 | +0.816 |

The first invocation overlapped other local compile/link work. The two following invocations ran consecutively from the same executable without rebuilding; both are reported rather than selecting the faster result. The machine was not otherwise isolated (recorded load averages were approximately 44/43/38). These are warm sequential requests, not a load test.

| Measured phase | Initial median / p95 (ms) | Repeat 1 median / p95 (ms) | Repeat 2 median / p95 (ms) |
| --- | ---: | ---: | ---: |
| GraphQL channel authorization (stubbed) | 0.003 / 0.006 | 0.002 / 0.002 | 0.002 / 0.003 |
| GraphQL real sequence read | 0.101 / 0.961 | 0.054 / 0.079 | 0.053 / 0.089 |
| GraphQL real domain page read | 1.934 / 7.376 | 1.286 / 1.552 | 1.317 / 1.685 |
| GraphQL mapping | 0.062 / 0.089 | 0.045 / 0.065 | 0.043 / 0.070 |
| GraphQL execute residual | 0.959 / 1.270 | 0.729 / 0.936 | 0.726 / 1.045 |
| GraphQL JSON serialization | 0.066 / 0.104 | 0.043 / 0.067 | 0.041 / 0.071 |
| REST real domain page read | 1.934 / 5.853 | 1.302 / 1.610 | 1.319 / 1.816 |
| REST JSON serialization | 0.114 / 0.153 | 0.079 / 0.126 | 0.071 / 0.135 |

The domain reads remain effectively equal. The new database round trip measures about 0.053–0.054 ms at the median in the consecutive runs. Most remaining overhead is GraphQL parsing, validation, dispatch and field resolution in the measured execute residual. Total time also includes cleanup; independently calculated phase percentiles are not additive. The adapter has small absolute overhead; the result does not claim literal equal latency.

Every run captured exactly **10 GraphQL statements versus 9 REST statements** on untimed inventory requests. A programmatic multiset comparison established that removing the one counter SELECT makes the GraphQL statements exactly equal to REST's nine. The counter SELECT was the first GraphQL SQL statement, before the page:

```sql
SELECT COALESCE((SELECT seq FROM channel_change_counters WHERE channel_id = $1), 0) AS "seq!"
```

The nine shared statements are channel existence, activity selection, root-message keyset selection, thread state/count/latest-reply lookup, three-reply previews, attachments, reactions, mentions and bot profiles. Full statement templates (without bound values) and all raw timings are retained in:

- `/tmp/channels-perf-real-seq-release.log`
- `/tmp/channels-perf-real-seq-repeat-1.log`
- `/tmp/channels-perf-real-seq-repeat-2.log`

The fixture runs on private PostgreSQL 18.4, through the `/tmp` socket at port 35432. It was copied from the authorized read-only shared seed: 50,000 messages, 40,000 thread rows, 219 attachments, 19,589 reactions, 1,480 mentions and no activity/call rows. CSV SHA256 values for every copied table matched source and private exports byte-for-byte. One reset log row and counter value 1 represent a completed historical import. The source was never written; every benchmark connection, including the private one, enforces `default_transaction_read_only=on` and a 15-second statement timeout. Copy script and verification manifest are `/tmp/channels-gql-copy-perf-fixture.py` and `/tmp/channels-gql-private-fixture/manifest.json`.

Authentication and channel authorization still use the composed-schema test harness. HTTP transport and production authorization queries are excluded. Both paths use the same real MessageService/PgMessageRepository/PgActivityRepo and four-connection pool. The scoped tracing layer measures span creation-to-close wall time, including awaits, for authorization, sequence, domain read and mapping; response serialization and residual execution are measured separately. This result supersedes the earlier zero-sequence performance proof; cross-database old/new totals are not used to estimate sequence cost.

Reproduce with `SQLX_OFFLINE` unset, `RUSTC_WRAPPER=` and `CARGO_TARGET_DIR=target/channel-perf-release`, both `DATABASE_URL` and `CHANNEL_PERF_DATABASE_URL` set to the private socket database, and `CHANNEL_PERF_CHANNEL_ID=5eed92f0-1c06-8932-b12c-277f6a59bad3`. Run `cargo test --release -p complete_graph --lib channel_latest_graphql_and_rest_server_timings -- --ignored --nocapture`. The measured executable was `target/channel-perf-release/release/deps/complete_graph-d195ad874a9c9aec`. The private-port guard and warmup assertion require a nonzero returned sequence on this fixture.

Post-rebase fixture regression validation also passed on the private database with `SQLX_OFFLINE` unset: `agent_trigger` 180 tests (including its edited outbound fixtures), `bots` 129, `channel_bots` 45, and `scheduled_action` 462 unit plus 6 integration tests. `agent_harness` passed its `cargo test --no-run` compile and then all 559 library tests under `cargo nextest run --lib --test-threads=2 --no-fail-fast`, with none skipped. Two synthetic `MessageEvent` literals in `channel_bots/src/outbound/conversation/test.rs` needed the new `seq: None` field after the rebase; no production logic changed. Logs are `/tmp/channels-post-seq-fixture-crates-test.log`, `/tmp/channels-post-seq-agent-harness-compile.log`, and `/tmp/channels-post-seq-agent-harness-nextest.log`.
