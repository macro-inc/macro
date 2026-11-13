# Fixed-arrival writes with per-parent admission

The tested implementation source is `a40fc0e55d5fe953728b04c93d2273b24e71d977`.
The old repository retains the methods, SQL and hydration pinned to
`354da677b5`.
The current process admits at most four writes per parent. Its
two-second wait happens before pool acquisition, and idle entries
are cleaned up. The append has a five-second database lock-wait
guard, with no total statement deadline or preflight round trip.
Both variants are measured without an artificial hold. The comparison
includes the complete repository change, not the isolated cost of one
mechanism.

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
| 1 | 50 | 2.336 / 3.033 / 3.518 | 1.975 / 2.639 / 3.231 | 50.0 | 50.0 |
| 1 | 200 | 2.090 / 2.724 / 3.171 | 2.286 / 2.933 / 3.429 | 200.0 | 200.1 |
| 1 | 1000 | 1.387 / 2.317 / 3.164 | 1.593 / 2.292 / 2.525 | 999.9 | 999.6 |
| 1 | 3000 | 1.663 / 2.524 / 2.881 | 1.375 / 2.303 / 2.554 | 2991.7 | 2989.6 |
| 16 | 50 | 1.839 / 2.535 / 3.161 | 1.850 / 3.154 / 4.112 | 50.0 | 50.0 |
| 16 | 200 | 1.762 / 2.502 / 3.385 | 1.720 / 2.313 / 2.580 | 200.1 | 200.1 |
| 16 | 1000 | 1.555 / 2.515 / 2.912 | 1.284 / 1.896 / 2.110 | 999.9 | 999.7 |
| 16 | 3000 | 1.640 / 2.587 / 2.812 | 1.482 / 2.273 / 2.504 | 2993.7 | 2996.2 |

## Every measured run

| Run | Channels | Offered writes/s | Variant | Arrival p50 / p95 / p99 ms | Achieved writes/s |
| ---: | ---: | ---: | --- | ---: | ---: |
| 1 | 1 | 50 | before | 2.557 / 3.199 / 3.703 | 50.0 |
| 1 | 1 | 50 | after | 2.590 / 4.671 / 8.122 | 50.0 |
| 1 | 1 | 200 | before | 1.958 / 2.620 / 2.931 | 200.0 |
| 1 | 1 | 200 | after | 2.286 / 2.933 / 3.429 | 200.0 |
| 1 | 1 | 1000 | before | 1.155 / 2.130 / 3.781 | 1000.1 |
| 1 | 1 | 1000 | after | 1.593 / 2.292 / 2.525 | 999.6 |
| 1 | 1 | 3000 | before | 1.304 / 2.154 / 2.371 | 2994.0 |
| 1 | 1 | 3000 | after | 1.257 / 2.146 / 2.389 | 2997.3 |
| 1 | 16 | 50 | before | 1.839 / 2.535 / 3.212 | 50.0 |
| 1 | 16 | 50 | after | 2.497 / 3.154 / 4.112 | 50.0 |
| 1 | 16 | 200 | before | 1.762 / 2.502 / 3.712 | 200.1 |
| 1 | 16 | 200 | after | 1.583 / 2.229 / 2.580 | 200.1 |
| 1 | 16 | 1000 | before | 1.555 / 2.515 / 2.912 | 999.9 |
| 1 | 16 | 1000 | after | 1.114 / 1.878 / 2.110 | 999.7 |
| 1 | 16 | 3000 | before | 1.660 / 2.587 / 2.812 | 2991.2 |
| 1 | 16 | 3000 | after | 1.482 / 2.334 / 2.721 | 2996.2 |
| 2 | 1 | 50 | before | 1.736 / 2.406 / 3.026 | 50.0 |
| 2 | 1 | 50 | after | 1.793 / 2.481 / 3.001 | 50.0 |
| 2 | 1 | 200 | before | 2.772 / 4.019 / 5.685 | 200.0 |
| 2 | 1 | 200 | after | 1.682 / 2.581 / 3.982 | 200.1 |
| 2 | 1 | 1000 | before | 1.387 / 2.317 / 3.164 | 999.9 |
| 2 | 1 | 1000 | after | 1.844 / 2.539 / 3.008 | 999.7 |
| 2 | 1 | 3000 | before | 1.663 / 2.524 / 3.066 | 2991.7 |
| 2 | 1 | 3000 | after | 1.375 / 2.303 / 2.576 | 2989.4 |
| 2 | 16 | 50 | before | 1.699 / 2.363 / 3.161 | 50.0 |
| 2 | 16 | 50 | after | 1.850 / 6.669 / 19.575 | 50.0 |
| 2 | 16 | 200 | before | 1.495 / 2.130 / 2.566 | 200.1 |
| 2 | 16 | 200 | after | 1.720 / 2.313 / 2.522 | 200.1 |
| 2 | 16 | 1000 | before | 1.260 / 2.084 / 2.296 | 999.9 |
| 2 | 16 | 1000 | after | 1.284 / 1.896 / 2.102 | 999.5 |
| 2 | 16 | 3000 | before | 1.502 / 2.367 / 2.600 | 2993.7 |
| 2 | 16 | 3000 | after | 1.352 / 2.084 / 2.360 | 2994.0 |
| 3 | 1 | 50 | before | 2.336 / 3.033 / 3.518 | 50.0 |
| 3 | 1 | 50 | after | 1.975 / 2.639 / 3.231 | 50.0 |
| 3 | 1 | 200 | before | 2.090 / 2.724 / 3.171 | 200.1 |
| 3 | 1 | 200 | after | 2.388 / 3.040 / 3.419 | 200.1 |
| 3 | 1 | 1000 | before | 1.691 / 2.577 / 2.896 | 999.5 |
| 3 | 1 | 1000 | after | 1.193 / 1.895 / 2.115 | 999.5 |
| 3 | 1 | 3000 | before | 1.705 / 2.613 / 2.881 | 2991.1 |
| 3 | 1 | 3000 | after | 1.490 / 2.368 / 2.554 | 2989.6 |
| 3 | 16 | 50 | before | 1.879 / 2.578 / 3.084 | 50.0 |
| 3 | 16 | 50 | after | 1.625 / 2.288 / 3.067 | 50.0 |
| 3 | 16 | 200 | before | 1.951 / 2.704 / 3.385 | 200.1 |
| 3 | 16 | 200 | after | 2.328 / 2.964 / 3.291 | 200.0 |
| 3 | 16 | 1000 | before | 1.964 / 4.416 / 7.966 | 996.8 |
| 3 | 16 | 1000 | after | 1.527 / 2.340 / 3.173 | 999.9 |
| 3 | 16 | 3000 | before | 1.640 / 2.635 / 2.880 | 2996.4 |
| 3 | 16 | 3000 | after | 1.491 / 2.273 / 2.504 | 2996.2 |

## Individual-run tails

Every run with p99 at least 10 ms is repeated below so medians do not
hide large tails. These are per-run percentiles, not maximum request
durations. The shared-host measurements do not identify their cause.

| Run | Channels | Offered writes/s | Variant | p50 / p95 / p99 ms | Achieved writes/s |
| ---: | ---: | ---: | --- | ---: | ---: |
| 2 | 16 | 50 | after | 1.850 / 6.669 / 19.575 | 50.0 |

The raw CSV also retains service latency, wall time and the verified
zero requested/actual holds. Historical pre-timeout results remain in
[channel_arrival_latency_results.md](channel_arrival_latency_results.md).
See [README.md](README.md) for current and historical rerun instructions.
