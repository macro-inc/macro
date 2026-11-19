# Channel sequence handoff

Branch: `synoet/channels-local-sync-seq`.
Measured repository source: `a40fc0e55d5fe953728b04c93d2273b24e71d977`.
Final head: `794a0b66ad9f4761c965a5b622c9cc7206b212ea`. No push or PR.

All database writes used dedicated local test databases on ports 22950/22951.
The application stack on port 22900 was not started, stopped, rebuilt or reseeded.

## Implemented

- Transactional per-channel counters and change logs, with sequences carried by
  existing message and activity realtime events.
- Authorized current-state catch-up reads: 200 log rows per page, roots and
  replies with their roots, activities, removed IDs and reset detection.
- Historical batch resets, changed-body repair logging, and call end/deletion
  logging for canonical call roots.
- Bounded 30-day retention from the existing calendar worker.
- Shared process-local admission for four live writes per typed parent before
  the write connection, with a two-second queue wait and retryable 503. This
  includes document parents. Idle entries are removed. The counter has a
  five-second lock-wait guard, preserving stricter inherited settings.

System activities have an **at-least-once** guarantee. DSS inserts selected
channel activities and their log rows atomically, returns sequence receipts in
memory, then publishes and acknowledges. Replay can append the same deterministic
activity ID again. The activity crate has no channel dependency; no extra activity
lookup index was added.

The final source changes after the measured head only align the document HTTP
error with the shared public contention text and update tests/reports. The
measured repository, gate, SQL and benchmark code is unchanged.

## Repository latency

Release, same PostgreSQL 18.4 database, three runs, at least 2,000 measured writes
per operation/variant/layout/run. Values are medians of the three per-run
percentiles, not pooled percentiles. All per-run results are retained.

All latency values are milliseconds, in p50 / p95 / p99 order.

| Writers | Channels | Operation | Old latency ms | Current latency ms | Old writes/s | Current writes/s |
| ---: | ---: | --- | ---: | ---: | ---: | ---: |
| 1 | 1 | Create | 1.028 / 1.484 / 2.186 | 0.779 / 1.077 / 1.268 | 911.2 | 1223.4 |
| 1 | 1 | Edit | 0.541 / 0.828 / 1.222 | 0.575 / 0.884 / 1.081 | 1792.6 | 1644.9 |
| 1 | 1 | React | 0.540 / 0.827 / 1.108 | 0.515 / 0.787 / 0.909 | 1745.5 | 1839.2 |
| 1 | 1 | Delete | 0.685 / 1.001 / 1.280 | 0.521 / 0.794 / 0.987 | 1386.6 | 1811.1 |
| 4 | 1 | Create | 0.709 / 0.911 / 1.152 | 0.583 / 0.845 / 1.042 | 5336.6 | 6515.0 |
| 4 | 1 | Edit | 0.523 / 0.692 / 0.834 | 0.520 / 0.729 / 0.887 | 7283.9 | 7378.4 |
| 4 | 1 | React | 0.487 / 0.720 / 0.871 | 0.381 / 0.577 / 0.739 | 7819.8 | 9874.1 |
| 4 | 1 | Delete | 0.603 / 0.906 / 1.175 | 0.589 / 0.858 / 1.129 | 6230.4 | 6448.3 |
| 16 | 1 | Create | 1.037 / 1.636 / 2.035 | 2.417 / 2.728 / 3.239 | 14324.5 | 6580.2 |
| 16 | 1 | Edit | 0.922 / 1.287 / 1.448 | 1.839 / 2.267 / 2.841 | 16574.6 | 8549.8 |
| 16 | 1 | React | 0.704 / 0.938 / 1.208 | 1.616 / 2.160 / 2.956 | 21099.5 | 8943.4 |
| 16 | 1 | Delete | 0.926 / 1.317 / 2.045 | 1.761 / 2.248 / 2.656 | 16438.8 | 8805.1 |
| 16 | 16 | Create | 1.169 / 1.523 / 1.699 | 0.955 / 1.351 / 1.893 | 13327.9 | 16082.6 |
| 16 | 16 | Edit | 0.838 / 1.291 / 1.602 | 0.561 / 0.862 / 1.081 | 17352.1 | 26547.5 |
| 16 | 16 | React | 0.653 / 0.967 / 1.175 | 0.567 / 0.833 / 0.965 | 23052.4 | 26617.4 |
| 16 | 16 | Delete | 0.653 / 0.906 / 1.080 | 0.506 / 0.665 / 0.962 | 23061.0 | 30037.5 |

Single-writer edit p95 rises by 0.056 ms; the other single-writer operations
improve. Saturating one channel with 16 writers increases p95 by 66.7–130.3%
and lowers throughput by 46.4–57.6%. This is the accepted counter serialization
tradeoff; the report does not claim blanket absence of regressions.

## Pool isolation

Pool minimum 10 / maximum 50, matching DSS, default 30-second acquire timeout;
neighbor 20 writes/s and flood 1,000/3,000 writes/s; no hold or requested 2/5 ms
pre-commit hold; three runs. All 7,200 neighbor requests succeeded. Neither lane
had database errors or pool acquisition timeouts. The current flood committed
146,788 writes and rejected 213,212 admissions out of 360,000 attempts.

Each variant has 600 neighbor attempts per row (200 in each run).
Latency columns are p50 / p95 / p99 in milliseconds.

| Flood/s | Hold ms | Old neighbor latency | Current neighbor latency | Old/current neighbor errors | Old/current pool timeouts |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1000 | 0.000 | 1.355 / 2.057 / 2.322 | 2.052 / 3.085 / 5.106 | 0 / 0 | 0 / 0 |
| 1000 | 2.000 | 4.656 / 5.620 / 6.667 | 4.915 / 5.736 / 6.141 | 0 / 0 | 0 / 0 |
| 1000 | 5.000 | 7.384 / 8.431 / 10.329 | 8.101 / 8.981 / 9.829 | 0 / 0 | 0 / 0 |
| 3000 | 0.000 | 1.526 / 2.476 / 4.068 | 1.297 / 2.284 / 3.267 | 0 / 0 | 0 / 0 |
| 3000 | 2.000 | 4.479 / 5.504 / 6.495 | 4.754 / 5.604 / 6.604 | 0 / 0 | 0 / 0 |
| 3000 | 5.000 | 7.419 / 8.488 / 9.512 | 7.802 / 8.692 / 9.315 | 0 / 0 | 0 / 0 |

## Flood outcomes

Rejected percentages count only typed admission rejections. The rejection
latency columns describe failed admission, not successful completion.

| Flood/s | Hold ms | Old/current successful writes/s | Current accepted / attempted | Current rejected (%) | Rejection arrival p50 / p95 / p99 ms | Rejection service p50 / p95 / p99 ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1000 | 0.000 | 999.600 / 999.500 | 30000 / 30000 | 0 (0.00%) | NA / NA / NA | NA / NA / NA |
| 1000 | 2.000 | 999.500 / 297.700 | 10762 / 30000 | 19238 (64.13%) | 2002.221 / 2002.703 / 2003.595 | 2001.086 / 2001.886 / 2002.038 |
| 1000 | 5.000 | 999.300 / 157.400 | 5682 / 30000 | 24318 (81.06%) | 2002.372 / 2003.359 / 2003.956 | 2001.089 / 2001.894 / 2002.026 |
| 3000 | 0.000 | 2995.100 / 2995.200 | 83850 / 90000 | 6150 (6.83%) | 2002.305 / 2009.126 / 2018.915 | 2001.037 / 2003.843 / 2009.560 |
| 3000 | 2.000 | 2994.400 / 299.500 | 10785 / 90000 | 79215 (88.02%) | 2002.025 / 2002.883 / 2003.622 | 2001.052 / 2001.871 / 2002.021 |
| 3000 | 5.000 | 2995.200 / 158.400 | 5709 / 90000 | 84291 (93.66%) | 2001.942 / 2002.873 / 2003.693 | 2001.062 / 2001.878 / 2002.011 |

Rejection service latency is about two seconds. The current 3,000/s no-hold
run 1 rejected 6,150/30,000 requests and had neighbor p95/p99 of 29.539/67.480 ms.
The 1,000/s no-hold run 3 rejected none but had flood p95/p99 of
1,571.525/1,727.476 ms and neighbor p95/p99 of 23.758/35.831 ms. These retained
outliers show bounded interference, not zero latency impact.

## Fixed-arrival latency

All latency values are milliseconds in p50 / p95 / p99 order. Values
are medians of the three per-run percentiles and achieved rates, not
percentiles from pooled samples. Every run is retained below and in CSV.

| Channels | Offered writes/s | Old latency ms | Current latency ms | Old achieved writes/s | Current achieved writes/s |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 50 | 2.336 / 3.033 / 3.518 | 1.975 / 2.639 / 3.231 | 50.0 | 50.0 |
| 1 | 200 | 2.090 / 2.724 / 3.171 | 2.286 / 2.933 / 3.429 | 200.0 | 200.1 |
| 1 | 1000 | 1.387 / 2.317 / 3.164 | 1.593 / 2.292 / 2.525 | 999.9 | 999.6 |
| 1 | 3000 | 1.663 / 2.524 / 2.881 | 1.375 / 2.303 / 2.554 | 2991.7 | 2989.6 |
| 16 | 50 | 1.839 / 2.535 / 3.161 | 1.850 / 3.154 / 4.112 | 50.0 | 50.0 |
| 16 | 200 | 1.762 / 2.502 / 3.385 | 1.720 / 2.313 / 2.580 | 200.1 | 200.1 |
| 16 | 1000 | 1.555 / 2.515 / 2.912 | 1.284 / 1.896 / 2.110 | 999.9 | 999.7 |
| 16 | 3000 | 1.640 / 2.587 / 2.812 | 1.482 / 2.273 / 2.504 | 2993.7 | 2996.2 |

One 16-channel 50/s run had p99 of 19.575 ms; the report retains this tail.

## Validation

All affected package suites passed: messages 204; gate 11; change utilities 7;
activity 76; bots 115; channels 388; documents 543; MacroDB 209; calendar 4;
call 393; DSS 98; import worker 21; import integration 181; agent harness 565;
agent session 567. Total: **3,382 tests**, excluding repeated runs and manual
performance tests. Call, DSS, import and session doc checks passed. The harness
ran its required process-isolated nextest library command.

Named regressions include `concurrent_writers_publish_gap_free_committed_prefix`,
`document_writes_execute_exactly_the_previous_statements`,
`twenty_simultaneous_channel_posts_succeed_with_commit_holds`,
`parent_admission_rejects_without_a_connection_and_client_id_retry_is_unique`,
`retry_after_admission_rejection_without_client_id_creates_one_message`,
`channel_counter_guard_rolls_back_the_entire_message`, and
`channel_stalled_holder_guard_applies_with_database_timeouts_disabled`.
Document statement counts remain create 11, edit 9, react 8, patch thread 3,
delete 8 and delete thread 4. Twenty simultaneous posts all succeed, including
with a requested five-millisecond commit hold.

SQLx preparation passed and generated `.sqlx` metadata is committed. Query
proofs cover 288 read/hydration/prune measurements, 32 current append-guard
measurements and 208 indexed admission-discovery measurements across PostgreSQL
14/18 with fresh/stale statistics and custom/generic plans. Log fixtures contain
at least 1,000,000 rows. `just rust-check`, `just clippy`, `just format`,
`just hakari`, `cargo fmt --all -- --check`, `cargo x deps --check`,
`just check`, `just pr-privacy`, both SQL source-equivalence checks and
`git diff --check` passed. Existing `just check` warnings concern unchanged files.

## Limits and deferred scope

- The user-deletion `cleanup_user_call_entities` trigger is unchanged. A retained
  cached channel call root can keep its old status until fetched or reset.
- Historical checkpoint/search completion and savepoint release still run under
  the counter lock; each statement is listed in the transaction audit.
- Cancellation after SQL starts can release admission before PostgreSQL finishes
  the query/rollback. Five seconds bounds each counter lock wait, not total
  post-cancel lifetime; earlier locks and COMMIT keep their existing settings.
  The cap applies per process to live admitted futures. Pending admission
  cancellation takes no connection.
- Known admission 503 retries occur before writes. Stable client IDs prevent
  duplicate messages. Webhook retries after an unknown commit outcome remain
  non-deduplicated because that payload has no nonce, as before.
- Live browser/Tempo and stack-level checks were not run here. No PR was opened
  and nothing was pushed.

## Durable proof entry points

- `crates/messages/proofs/channel_admission_validation.md`
- `crates/messages/proofs/channel_admission_write_latency_results.md`
- `crates/messages/proofs/channel_admission_arrival_latency_results.md`
- `crates/messages/proofs/channel_admission_pool_results.md`
- `crates/messages/proofs/channel_transaction_audit.md`
- `crates/messages/proofs/channel_writer_rates.md`
- `crates/messages/proofs/README.md` (rerun commands)
