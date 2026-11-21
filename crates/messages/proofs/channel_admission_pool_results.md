# Fixed-arrival admission and shared-pool isolation

Tested implementation source: `a40fc0e55d5fe953728b04c93d2273b24e71d977`.
The old methods are pinned to `354da677b5`. The current process admits
four writes per parent and bounds admission waiting to two seconds,
before pool acquisition. Idle entries are cleaned up. The database
append retains a five-second lock-wait guard. The old methods bypass
admission; their SQL, hydration and transaction boundaries are unchanged.

Release profile and sixteen Tokio workers, one pool configured with
minimum 10 / maximum 50 connections and its default 30-second acquire
timeout. All 50 connections are opened before measurement. Each case
uses two channels: 1,000 or 3,000 fixed flood arrivals per second and
20 fixed neighbor arrivals per second for ten seconds, with full drain.
Each write edits a distinct preseeded row, so message-row contention
does not substitute for contention on the parent. Fixtures and cleanup
are outside the measurement. Three runs compare old and current methods
with no synthetic hold, or a requested 2 / 5 ms hold before COMMIT.

Both arrival schedulers preserve original timestamps, including late
ticks. Every request is spawned independently: there is no external
semaphore or completion-dependent arrival loop. Arrival latency includes
scheduler delay, gate and pool waits, SQL and commit. Rejection service
time starts at the repository call; rejection arrival time includes
scheduler lateness too. Rates use each lane's own time through its last
completion. No request is retried or dropped.

Admission-accepted counts mean attempts without a typed AdmissionTimeout;
they can include a subsequent database failure. Successful writes mean
COMMIT returned successfully. Admission rejections, database SQLSTATEs
and pool-acquisition timeouts are counted separately. Missing latency
samples are NA. Medians below are medians of per-run percentiles/rates;
counts and fractions aggregate the three complete runs. Every raw row
is retained in CSV and every neighbor run appears below.

## Neighbor comparison

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

## Flood admission and completion

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

## Every neighbor run

| Run | Flood/s | Hold ms | Variant | p50 / p95 / p99 ms | Errors | Admission rejected | Pool timeout |
| ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| 1 | 1000 | 0.000 | before | 1.182 / 2.057 / 2.254 | 0 | 0 | 0 |
| 1 | 1000 | 0.000 | after | 2.052 / 2.729 / 3.502 | 0 | 0 | 0 |
| 1 | 1000 | 2.000 | before | 5.455 / 5.869 / 6.796 | 0 | 0 | 0 |
| 1 | 1000 | 2.000 | after | 4.915 / 5.736 / 6.141 | 0 | 0 | 0 |
| 1 | 1000 | 5.000 | before | 7.859 / 8.852 / 9.544 | 0 | 0 | 0 |
| 1 | 1000 | 5.000 | after | 8.155 / 8.986 / 9.829 | 0 | 0 | 0 |
| 1 | 3000 | 0.000 | before | 1.526 / 2.476 / 2.886 | 0 | 0 | 0 |
| 1 | 3000 | 0.000 | after | 1.801 / 29.539 / 67.480 | 0 | 0 | 0 |
| 1 | 3000 | 2.000 | before | 4.479 / 5.504 / 5.634 | 0 | 0 | 0 |
| 1 | 3000 | 2.000 | after | 5.034 / 6.012 / 6.988 | 0 | 0 | 0 |
| 1 | 3000 | 5.000 | before | 7.162 / 8.199 / 9.241 | 0 | 0 | 0 |
| 1 | 3000 | 5.000 | after | 7.639 / 8.553 / 9.315 | 0 | 0 | 0 |
| 2 | 1000 | 0.000 | before | 1.399 / 2.142 / 2.322 | 0 | 0 | 0 |
| 2 | 1000 | 0.000 | after | 1.465 / 3.085 / 5.106 | 0 | 0 | 0 |
| 2 | 1000 | 2.000 | before | 4.656 / 5.620 / 6.667 | 0 | 0 | 0 |
| 2 | 1000 | 2.000 | after | 5.330 / 6.049 / 6.107 | 0 | 0 | 0 |
| 2 | 1000 | 5.000 | before | 7.384 / 8.431 / 10.536 | 0 | 0 | 0 |
| 2 | 1000 | 5.000 | after | 8.028 / 8.961 / 9.957 | 0 | 0 | 0 |
| 2 | 3000 | 0.000 | before | 1.434 / 2.403 / 4.068 | 0 | 0 | 0 |
| 2 | 3000 | 0.000 | after | 1.242 / 2.254 / 3.267 | 0 | 0 | 0 |
| 2 | 3000 | 2.000 | before | 4.624 / 5.625 / 6.495 | 0 | 0 | 0 |
| 2 | 3000 | 2.000 | after | 4.754 / 5.604 / 5.975 | 0 | 0 | 0 |
| 2 | 3000 | 5.000 | before | 7.951 / 9.517 / 11.582 | 0 | 0 | 0 |
| 2 | 3000 | 5.000 | after | 8.181 / 9.014 / 9.827 | 0 | 0 | 0 |
| 3 | 1000 | 0.000 | before | 1.355 / 2.032 / 5.333 | 0 | 0 | 0 |
| 3 | 1000 | 0.000 | after | 2.237 / 23.758 / 35.831 | 0 | 0 | 0 |
| 3 | 1000 | 2.000 | before | 4.492 / 5.475 / 6.447 | 0 | 0 | 0 |
| 3 | 1000 | 2.000 | after | 4.416 / 5.320 / 6.238 | 0 | 0 | 0 |
| 3 | 1000 | 5.000 | before | 7.294 / 8.349 / 10.329 | 0 | 0 | 0 |
| 3 | 1000 | 5.000 | after | 8.101 / 8.981 / 9.788 | 0 | 0 | 0 |
| 3 | 3000 | 0.000 | before | 1.966 / 2.788 / 4.581 | 0 | 0 | 0 |
| 3 | 3000 | 0.000 | after | 1.297 / 2.284 / 2.470 | 0 | 0 | 0 |
| 3 | 3000 | 2.000 | before | 4.147 / 5.212 / 7.154 | 0 | 0 | 0 |
| 3 | 3000 | 2.000 | after | 4.666 / 5.552 / 6.604 | 0 | 0 | 0 |
| 3 | 3000 | 5.000 | before | 7.419 / 8.488 / 9.512 | 0 | 0 | 0 |
| 3 | 3000 | 5.000 | after | 7.802 / 8.692 / 8.779 | 0 | 0 | 0 |

## Database and pool errors, every run

| Run | Flood/s | Hold ms | Variant | Lane | Pool timeout | 55P03 | 57014 | 40P01 | Other |
| ---: | ---: | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 1000 | 0.000 | before | neighbor | 0 | 0 | 0 | 0 | 0 |
| 1 | 1000 | 0.000 | before | flood | 0 | 0 | 0 | 0 | 0 |
| 1 | 1000 | 0.000 | after | neighbor | 0 | 0 | 0 | 0 | 0 |
| 1 | 1000 | 0.000 | after | flood | 0 | 0 | 0 | 0 | 0 |
| 1 | 1000 | 2.000 | before | neighbor | 0 | 0 | 0 | 0 | 0 |
| 1 | 1000 | 2.000 | before | flood | 0 | 0 | 0 | 0 | 0 |
| 1 | 1000 | 2.000 | after | neighbor | 0 | 0 | 0 | 0 | 0 |
| 1 | 1000 | 2.000 | after | flood | 0 | 0 | 0 | 0 | 0 |
| 1 | 1000 | 5.000 | before | neighbor | 0 | 0 | 0 | 0 | 0 |
| 1 | 1000 | 5.000 | before | flood | 0 | 0 | 0 | 0 | 0 |
| 1 | 1000 | 5.000 | after | neighbor | 0 | 0 | 0 | 0 | 0 |
| 1 | 1000 | 5.000 | after | flood | 0 | 0 | 0 | 0 | 0 |
| 1 | 3000 | 0.000 | before | neighbor | 0 | 0 | 0 | 0 | 0 |
| 1 | 3000 | 0.000 | before | flood | 0 | 0 | 0 | 0 | 0 |
| 1 | 3000 | 0.000 | after | neighbor | 0 | 0 | 0 | 0 | 0 |
| 1 | 3000 | 0.000 | after | flood | 0 | 0 | 0 | 0 | 0 |
| 1 | 3000 | 2.000 | before | neighbor | 0 | 0 | 0 | 0 | 0 |
| 1 | 3000 | 2.000 | before | flood | 0 | 0 | 0 | 0 | 0 |
| 1 | 3000 | 2.000 | after | neighbor | 0 | 0 | 0 | 0 | 0 |
| 1 | 3000 | 2.000 | after | flood | 0 | 0 | 0 | 0 | 0 |
| 1 | 3000 | 5.000 | before | neighbor | 0 | 0 | 0 | 0 | 0 |
| 1 | 3000 | 5.000 | before | flood | 0 | 0 | 0 | 0 | 0 |
| 1 | 3000 | 5.000 | after | neighbor | 0 | 0 | 0 | 0 | 0 |
| 1 | 3000 | 5.000 | after | flood | 0 | 0 | 0 | 0 | 0 |
| 2 | 1000 | 0.000 | before | neighbor | 0 | 0 | 0 | 0 | 0 |
| 2 | 1000 | 0.000 | before | flood | 0 | 0 | 0 | 0 | 0 |
| 2 | 1000 | 0.000 | after | neighbor | 0 | 0 | 0 | 0 | 0 |
| 2 | 1000 | 0.000 | after | flood | 0 | 0 | 0 | 0 | 0 |
| 2 | 1000 | 2.000 | before | neighbor | 0 | 0 | 0 | 0 | 0 |
| 2 | 1000 | 2.000 | before | flood | 0 | 0 | 0 | 0 | 0 |
| 2 | 1000 | 2.000 | after | neighbor | 0 | 0 | 0 | 0 | 0 |
| 2 | 1000 | 2.000 | after | flood | 0 | 0 | 0 | 0 | 0 |
| 2 | 1000 | 5.000 | before | neighbor | 0 | 0 | 0 | 0 | 0 |
| 2 | 1000 | 5.000 | before | flood | 0 | 0 | 0 | 0 | 0 |
| 2 | 1000 | 5.000 | after | neighbor | 0 | 0 | 0 | 0 | 0 |
| 2 | 1000 | 5.000 | after | flood | 0 | 0 | 0 | 0 | 0 |
| 2 | 3000 | 0.000 | before | neighbor | 0 | 0 | 0 | 0 | 0 |
| 2 | 3000 | 0.000 | before | flood | 0 | 0 | 0 | 0 | 0 |
| 2 | 3000 | 0.000 | after | neighbor | 0 | 0 | 0 | 0 | 0 |
| 2 | 3000 | 0.000 | after | flood | 0 | 0 | 0 | 0 | 0 |
| 2 | 3000 | 2.000 | before | neighbor | 0 | 0 | 0 | 0 | 0 |
| 2 | 3000 | 2.000 | before | flood | 0 | 0 | 0 | 0 | 0 |
| 2 | 3000 | 2.000 | after | neighbor | 0 | 0 | 0 | 0 | 0 |
| 2 | 3000 | 2.000 | after | flood | 0 | 0 | 0 | 0 | 0 |
| 2 | 3000 | 5.000 | before | neighbor | 0 | 0 | 0 | 0 | 0 |
| 2 | 3000 | 5.000 | before | flood | 0 | 0 | 0 | 0 | 0 |
| 2 | 3000 | 5.000 | after | neighbor | 0 | 0 | 0 | 0 | 0 |
| 2 | 3000 | 5.000 | after | flood | 0 | 0 | 0 | 0 | 0 |
| 3 | 1000 | 0.000 | before | neighbor | 0 | 0 | 0 | 0 | 0 |
| 3 | 1000 | 0.000 | before | flood | 0 | 0 | 0 | 0 | 0 |
| 3 | 1000 | 0.000 | after | neighbor | 0 | 0 | 0 | 0 | 0 |
| 3 | 1000 | 0.000 | after | flood | 0 | 0 | 0 | 0 | 0 |
| 3 | 1000 | 2.000 | before | neighbor | 0 | 0 | 0 | 0 | 0 |
| 3 | 1000 | 2.000 | before | flood | 0 | 0 | 0 | 0 | 0 |
| 3 | 1000 | 2.000 | after | neighbor | 0 | 0 | 0 | 0 | 0 |
| 3 | 1000 | 2.000 | after | flood | 0 | 0 | 0 | 0 | 0 |
| 3 | 1000 | 5.000 | before | neighbor | 0 | 0 | 0 | 0 | 0 |
| 3 | 1000 | 5.000 | before | flood | 0 | 0 | 0 | 0 | 0 |
| 3 | 1000 | 5.000 | after | neighbor | 0 | 0 | 0 | 0 | 0 |
| 3 | 1000 | 5.000 | after | flood | 0 | 0 | 0 | 0 | 0 |
| 3 | 3000 | 0.000 | before | neighbor | 0 | 0 | 0 | 0 | 0 |
| 3 | 3000 | 0.000 | before | flood | 0 | 0 | 0 | 0 | 0 |
| 3 | 3000 | 0.000 | after | neighbor | 0 | 0 | 0 | 0 | 0 |
| 3 | 3000 | 0.000 | after | flood | 0 | 0 | 0 | 0 | 0 |
| 3 | 3000 | 2.000 | before | neighbor | 0 | 0 | 0 | 0 | 0 |
| 3 | 3000 | 2.000 | before | flood | 0 | 0 | 0 | 0 | 0 |
| 3 | 3000 | 2.000 | after | neighbor | 0 | 0 | 0 | 0 | 0 |
| 3 | 3000 | 2.000 | after | flood | 0 | 0 | 0 | 0 | 0 |
| 3 | 3000 | 5.000 | before | neighbor | 0 | 0 | 0 | 0 | 0 |
| 3 | 3000 | 5.000 | before | flood | 0 | 0 | 0 | 0 | 0 |
| 3 | 3000 | 5.000 | after | neighbor | 0 | 0 | 0 | 0 | 0 |
| 3 | 3000 | 5.000 | after | flood | 0 | 0 | 0 | 0 | 0 |

The requested hold is a stress input, not measured production disk
latency. Actual hold distributions and every admission count are in the
CSV. The shared host limits causal attribution; keep these results
separate from the discarded deadline and closed-loop pool experiments.
See [README.md](README.md) for commands and the simultaneous-post test.
