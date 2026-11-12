# Historical fixed-arrival and delayed-commit write results

Historical source snapshot: `before` is pinned to `354da677b5`; `after` is
the pre-timeout implementation at `5743b47a10`. All numbers in this report
predate both the discarded per-lock limits and the total statement deadline.
They are retained as baseline evidence, not current deadline measurements.
Reproduce them only with the original source and benchmark harness in a separate
checkout. Current below-ceiling and shared-pool evidence uses the result-recording
runners described in [README.md](README.md).

Release build, one local PostgreSQL 18.4 database server, sixteen Tokio
workers and sixteen connections. Database files were on local tmpfs;
fsync and synchronous_commit were enabled. The injected delay adds
lock occupancy but does not reproduce a particular production disk.
Each row compares the pinned old
repository with the pre-timeout repository on the same server: three runs
of 2,000 mixed writes each (500 create, edit, react and delete). Each
case has 128 unmeasured warmup writes. The four operations use distinct
message rows; all operations rotate through all selected channels.

Table values are medians of the three per-run percentiles and achieved
rates, not percentiles pooled across runs. The CSV retains every run.
Latency starts at the original scheduled arrival and includes scheduler
delay, the sixteen-worker admission queue, pool and counter waits, SQL,
and commit acknowledgement. A fixed timer schedules every arrival
independently of completions; missed ticks burst with their original
timestamps. No arrival is dropped. Achieved rate is completed writes
divided by wall time from first scheduled arrival through final completion.
This worktree's builds, tests and query-plan jobs were idle during timing.
The host was shared with other worktrees, so these local measurements
are not a guarantee of production capacity or an isolated-host result.

## Fixed arrivals without an injected delay

| Channels | Offered writes/s | Old p50 / p95 / p99 ms | New p50 / p95 / p99 ms | Old achieved/s | New achieved/s |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 50 | 2.065 / 2.696 / 3.239 | 1.838 / 2.416 / 3.046 | 50.0 | 50.0 |
| 1 | 200 | 1.851 / 2.378 / 2.610 | 1.670 / 2.253 / 2.519 | 200.1 | 200.1 |
| 1 | 1000 | 1.476 / 2.103 / 2.322 | 1.847 / 2.473 / 2.583 | 999.7 | 999.7 |
| 1 | 3000 | 1.449 / 2.313 / 2.588 | 1.249 / 2.003 / 2.375 | 2993.9 | 2994.1 |
| 16 | 50 | 2.221 / 2.855 / 3.099 | 1.931 / 2.596 / 3.240 | 50.0 | 50.0 |
| 16 | 200 | 2.008 / 2.545 / 2.765 | 1.642 / 2.147 / 2.360 | 200.1 | 200.1 |
| 16 | 1000 | 1.529 / 2.299 / 2.650 | 1.830 / 2.481 / 2.673 | 999.9 | 999.5 |
| 16 | 3000 | 1.516 / 2.404 / 2.714 | 1.300 / 2.068 / 2.381 | 2992.9 | 2994.5 |

## Synthetic pre-commit hold in one channel

Benchmark-only copies preserve each variant's ordered SQL and insert
one asynchronous sleep after its final statement, immediately before
COMMIT. The current copy holds the counter during that sleep; the old
copy has no counter. Production code has no artificial delay or hook.
Requested sleeps are minimum delays, not exact server commit latency;
Tokio timer granularity and scheduling can lengthen them. The measured
sleep distributions below make that difference explicit. Real commit
round trips also remain in both measurements. These are sensitivity
measurements, not predictions of a deployed database's capacity.

| Requested hold ms | Mode | Offered writes/s | Old p50 / p95 / p99 ms | New p50 / p95 / p99 ms | Old achieved/s | New achieved/s | Old actual hold p50 / p95 ms | New actual hold p50 / p95 ms |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | closed_loop | - | 3.781 / 4.759 / 4.961 | 31.792 / 157.281 / 255.691 | 4076.4 | 307.8 | 2.916 / 3.737 | 3.313 / 3.605 |
| 2 | open_loop | 20 | 5.377 / 5.982 / 6.999 | 5.022 / 5.791 / 7.563 | 20.0 | 20.0 | 3.061 / 3.078 | 3.061 / 3.087 |
| 2 | open_loop | 50 | 4.793 / 5.548 / 6.298 | 5.315 / 5.900 / 6.854 | 50.0 | 50.0 | 3.061 / 3.086 | 3.061 / 3.112 |
| 2 | open_loop | 100 | 5.395 / 6.138 / 6.869 | 4.723 / 5.333 / 6.668 | 100.0 | 100.0 | 3.060 / 3.072 | 3.060 / 3.070 |
| 2 | open_loop | 200 | 5.126 / 5.677 / 5.951 | 5.043 / 5.787 / 8.428 | 200.0 | 200.0 | 3.059 / 3.071 | 3.059 / 3.092 |
| 5 | closed_loop | - | 7.086 / 8.215 / 10.411 | 55.132 / 332.080 / 504.791 | 2155.0 | 157.2 | 5.916 / 6.786 | 6.334 / 6.692 |
| 5 | open_loop | 20 | 8.546 / 9.396 / 12.002 | 8.177 / 9.704 / 11.918 | 20.0 | 20.0 | 6.064 / 6.116 | 6.063 / 6.119 |
| 5 | open_loop | 50 | 8.196 / 9.120 / 11.760 | 8.284 / 9.022 / 10.991 | 50.0 | 50.0 | 6.062 / 6.119 | 6.062 / 6.117 |
| 5 | open_loop | 100 | 7.694 / 8.483 / 10.250 | 8.157 / 8.814 / 9.559 | 100.0 | 100.0 | 6.061 / 6.116 | 6.061 / 6.118 |
| 5 | open_loop | 200 | 8.103 / 8.790 / 9.658 | 1331.139 / 2525.370 / 2700.691 | 199.9 | 158.1 | 5.949 / 6.875 | 6.074 / 6.747 |

### Run variation near capacity

At 2 ms requested hold and 200 offered writes/s, arrival p95 in runs 1/2/3 was 5.994 / 5.419 / 5.677 ms before and 302.770 / 5.787 / 5.582 ms after.

At 5 ms requested hold and 200 offered writes/s, arrival p95 in runs 1/2/3 was 8.939 / 8.396 / 8.790 ms before and 2400.778 / 2525.370 / 2688.727 ms after.

Open-loop samples with p99 at least 100 ms are listed explicitly,
including tails below the measured saturation rate:

| Hold ms | Offered writes/s | Run | Variant | p95 ms | p99 ms | Achieved writes/s |
| ---: | ---: | ---: | --- | ---: | ---: | ---: |
| 2.000 | 200 | 1 | after | 302.770 | 444.675 | 197.4 |
| 5.000 | 200 | 1 | after | 2400.778 | 2564.458 | 159.6 |
| 5.000 | 200 | 2 | after | 2525.370 | 2700.691 | 158.1 |
| 5.000 | 50 | 3 | after | 12.073 | 391.052 | 50.0 |
| 5.000 | 200 | 3 | after | 2688.727 | 2868.667 | 155.9 |

A median does not imply that every run stayed near that value. Use the
per-run values and actual hold distributions when assessing tail risk.

The closed-loop cases have sixteen continuously active writers and
measure saturation. The open-loop cases preserve offered work even
when demand exceeds the measured ceiling; a lower achieved rate and
growing end-to-end latency therefore expose the backlog instead of
hiding it by slowing the request generator.

See [the writer-rate audit](channel_writer_rates.md) for the absence
of a general per-channel rate cap, and
[the transaction audit](channel_transaction_audit.md) for lock lifetime and timeout behavior.
The [closed-loop repository results](channel_write_latency_results.md)
retain the original per-operation saturation comparison.

Reproduce the historical commands from the pre-timeout source/harness checkout
(see [README.md](README.md)), then run:

```sh
python3 crates/messages/proofs/summarize_arrival_latency.py \
  /tmp/open-loop.log /tmp/commit-delay.log
```
