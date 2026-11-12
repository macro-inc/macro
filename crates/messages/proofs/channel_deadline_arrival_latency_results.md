# Fixed-arrival writes with a total counter deadline

The tested deadline implementation source is `70d9301ff9ed571d2c849624f02a2c4f9fc60802`.
The old repository retains the methods, SQL and hydration pinned to
`354da677b5`. The current path sets a total 50 ms counter-allocation
statement deadline, preserving a stricter inherited deadline, in one
round trip before acquiring the counter. The append restores the prior
setting within its statement. Both variants are measured without an
artificial hold. This comparison includes the complete repository change,
not an isolated measurement of deadline configuration cost.

Release profile, sixteen Tokio workers and sixteen database connections.
One dedicated local PostgreSQL 18.4 server with files on tmpfs, fsync and
synchronous_commit enabled. This worktree's compiler, plan jobs and tests
were idle during measurement; other worktrees shared the host. This is
not an isolated-host or production-disk measurement.

Each of 48 cases has 2,000 mixed writes, 500 each of create, edit, react
and delete, following 128 unmeasured warmups. Three repetitions compare
old/current implementations at 50, 200, 1,000 and 3,000 total arrivals/s
in one and sixteen channels. Operations rotate independently through
channels. Fixture creation, warmup and cleanup are outside measurement.

The scheduler retains every original arrival timestamp and runs
independently of completions. Requests queue for one of sixteen workers.
Arrival latency includes scheduler lateness, admission, pool and counter
waits, SQL and commit acknowledgement. Achieved rate includes draining
the final requests. The runner does not retry; repository errors abort
the test, so a full successful matrix cannot silently discard failures.

## Three-run comparison

All latency values are milliseconds in p50 / p95 / p99 order. Values
are medians of the three per-run percentiles and achieved rates, not
percentiles from pooled samples. Every run is retained below and in CSV.

| Channels | Offered writes/s | Old latency ms | Current latency ms | Old achieved writes/s | Current achieved writes/s |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 50 | 2.281 / 3.218 / 4.786 | 2.706 / 4.253 / 6.528 | 50.0 | 50.0 |
| 1 | 200 | 2.616 / 3.338 / 4.593 | 1.870 / 2.642 / 4.066 | 200.1 | 200.1 |
| 1 | 1000 | 2.079 / 2.905 / 3.454 | 1.422 / 2.268 / 2.651 | 999.1 | 999.8 |
| 1 | 3000 | 1.518 / 2.604 / 3.023 | 1.541 / 2.575 / 2.945 | 2994.1 | 2996.0 |
| 16 | 50 | 2.481 / 3.205 / 4.696 | 2.468 / 3.434 / 4.652 | 50.0 | 50.0 |
| 16 | 200 | 2.183 / 2.947 / 4.690 | 2.066 / 2.692 / 3.932 | 200.1 | 200.1 |
| 16 | 1000 | 1.677 / 2.490 / 3.678 | 1.583 / 2.336 / 2.855 | 999.9 | 999.7 |
| 16 | 3000 | 1.731 / 2.732 / 3.388 | 1.493 / 2.523 / 3.763 | 2993.2 | 2994.6 |

## Every measured run

| Run | Channels | Offered writes/s | Variant | Arrival p50 / p95 / p99 ms | Achieved writes/s |
| ---: | ---: | ---: | --- | ---: | ---: |
| 1 | 1 | 50 | before | 2.281 / 4.271 / 6.709 | 50.0 |
| 1 | 1 | 50 | after | 2.706 / 4.977 / 6.766 | 50.0 |
| 1 | 1 | 200 | before | 2.145 / 2.909 / 4.278 | 200.0 |
| 1 | 1 | 200 | after | 1.870 / 2.642 / 3.863 | 200.1 |
| 1 | 1 | 1000 | before | 2.079 / 2.905 / 3.454 | 999.1 |
| 1 | 1 | 1000 | after | 1.422 / 2.268 / 2.651 | 999.6 |
| 1 | 1 | 3000 | before | 1.630 / 2.604 / 3.023 | 2994.1 |
| 1 | 1 | 3000 | after | 1.541 / 2.575 / 2.942 | 2994.1 |
| 1 | 16 | 50 | before | 2.825 / 3.640 / 5.037 | 50.0 |
| 1 | 16 | 50 | after | 2.468 / 4.617 / 274.706 | 50.0 |
| 1 | 16 | 200 | before | 2.313 / 6.038 / 11.105 | 200.1 |
| 1 | 16 | 200 | after | 2.509 / 3.208 / 3.932 | 200.1 |
| 1 | 16 | 1000 | before | 1.995 / 2.907 / 4.049 | 999.6 |
| 1 | 16 | 1000 | after | 1.563 / 2.336 / 2.573 | 999.7 |
| 1 | 16 | 3000 | before | 1.747 / 2.852 / 3.148 | 2991.2 |
| 1 | 16 | 3000 | after | 1.483 / 2.656 / 4.302 | 2993.4 |
| 2 | 1 | 50 | before | 2.297 / 3.218 / 4.786 | 50.0 |
| 2 | 1 | 50 | after | 2.369 / 3.129 / 4.448 | 50.0 |
| 2 | 1 | 200 | before | 2.616 / 3.338 / 4.593 | 200.1 |
| 2 | 1 | 200 | after | 1.607 / 2.298 / 4.066 | 200.1 |
| 2 | 1 | 1000 | before | 1.912 / 2.740 / 3.437 | 999.7 |
| 2 | 1 | 1000 | after | 1.009 / 1.614 / 2.073 | 1000.1 |
| 2 | 1 | 3000 | before | 1.441 / 2.463 / 2.902 | 2991.3 |
| 2 | 1 | 3000 | after | 1.460 / 2.524 / 2.945 | 2997.2 |
| 2 | 16 | 50 | before | 2.481 / 3.205 / 4.696 | 50.0 |
| 2 | 16 | 50 | after | 2.303 / 2.987 / 4.202 | 50.0 |
| 2 | 16 | 200 | before | 1.979 / 2.787 / 4.690 | 200.0 |
| 2 | 16 | 200 | after | 2.066 / 2.692 / 3.961 | 200.1 |
| 2 | 16 | 1000 | before | 1.182 / 1.971 / 3.678 | 1000.1 |
| 2 | 16 | 1000 | after | 1.583 / 2.230 / 2.855 | 999.9 |
| 2 | 16 | 3000 | before | 1.490 / 2.547 / 3.388 | 2995.0 |
| 2 | 16 | 3000 | after | 1.493 / 2.424 / 2.744 | 2995.8 |
| 3 | 1 | 50 | before | 1.940 / 2.587 / 3.452 | 50.0 |
| 3 | 1 | 50 | after | 2.728 / 4.253 / 6.528 | 50.0 |
| 3 | 1 | 200 | before | 2.803 / 4.552 / 7.784 | 200.1 |
| 3 | 1 | 200 | after | 2.054 / 3.420 / 5.951 | 200.1 |
| 3 | 1 | 1000 | before | 2.141 / 3.038 / 3.859 | 999.0 |
| 3 | 1 | 1000 | after | 1.854 / 2.580 / 4.540 | 999.8 |
| 3 | 1 | 3000 | before | 1.518 / 2.662 / 3.773 | 2994.1 |
| 3 | 1 | 3000 | after | 1.738 / 3.573 / 9.054 | 2996.0 |
| 3 | 16 | 50 | before | 1.776 / 2.446 / 3.404 | 50.0 |
| 3 | 16 | 50 | after | 2.588 / 3.434 / 4.652 | 50.0 |
| 3 | 16 | 200 | before | 2.183 / 2.947 / 4.546 | 200.1 |
| 3 | 16 | 200 | after | 2.007 / 2.599 / 3.314 | 200.1 |
| 3 | 16 | 1000 | before | 1.677 / 2.490 / 2.781 | 999.9 |
| 3 | 16 | 1000 | after | 1.735 / 2.501 / 3.070 | 999.5 |
| 3 | 16 | 3000 | before | 1.731 / 2.732 / 5.013 | 2993.2 |
| 3 | 16 | 3000 | after | 1.587 / 2.523 / 3.763 | 2994.6 |

## Individual-run tails

Every run with p99 at least 10 ms is repeated below so medians do not
hide large tails. These are per-run percentiles, not maximum request
durations. The shared-host measurements do not identify their cause.

| Run | Channels | Offered writes/s | Variant | p50 / p95 / p99 ms | Achieved writes/s |
| ---: | ---: | ---: | --- | ---: | ---: |
| 1 | 16 | 50 | after | 2.468 / 4.617 / 274.706 | 50.0 |
| 1 | 16 | 200 | before | 2.313 / 6.038 / 11.105 | 200.1 |

The raw CSV also retains service latency, wall time and the verified
zero requested/actual holds. Historical pre-timeout results remain in
[channel_arrival_latency_results.md](channel_arrival_latency_results.md).
See [README.md](README.md) for current and historical rerun instructions.
