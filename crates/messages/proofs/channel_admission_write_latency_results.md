# Repository write latency with per-parent admission

The tested implementation source is `a40fc0e55d5fe953728b04c93d2273b24e71d977`.
The old repository is pinned to `354da677b5`, including its SQL,
hydration and transaction boundaries.
The current channel path admits at most four writers per parent in
this process. Waiting for admission happens before pool acquisition
and has a two-second bound. Idle gate entries are cleaned up. The
database append retains a five-second lock-wait guard, with no
new total statement deadline or preflight round trip.
These numbers compare full repository implementations; their difference
does not isolate the cost of any one mechanism.

Release profile, sixteen Tokio workers, one dedicated local PostgreSQL
18.4 server with files on tmpfs, fsync and synchronous_commit enabled.
Both variants use the same database. The pool permits 32 connections;
sixteen are opened before timing. This worktree's compiler, plans and
other tests were idle during measurement; the host was shared with other
worktrees. This is not an isolated-host or production-disk measurement.

The complete matrix has 96 rows: three repetitions, four writer/channel
layouts, four operations, and two repository variants. Every row contains
2,000 successful writes after 128 unmeasured warmups. Setup, worker
startup and cleanup are outside timing. This runner does not retry and
fails on repository errors; it cannot discard failures and finish the
matrix. The separate bounded and shared-pool runners retain error metrics.

The tables show medians of the three per-run percentiles and throughputs,
not percentiles of pooled samples. The CSV retains each run.

## Full matrix

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

## Single-writer change

Each delta is current minus old, calculated from the medians shown above.
Positive latency values mean slower writes; negative values mean faster
writes. Percent changes use the old latency as the denominator.

| Operation | p50 delta | p95 delta | p99 delta | Throughput delta |
| --- | ---: | ---: | ---: | ---: |
| Create | -0.249 ms (-24.2%) | -0.407 ms (-27.4%) | -0.918 ms (-42.0%) | +312.2 writes/s (+34.3%) |
| Edit | +0.034 ms (+6.3%) | +0.056 ms (+6.8%) | -0.141 ms (-11.5%) | -147.7 writes/s (-8.2%) |
| React | -0.025 ms (-4.6%) | -0.040 ms (-4.8%) | -0.199 ms (-18.0%) | +93.7 writes/s (+5.4%) |
| Delete | -0.164 ms (-23.9%) | -0.207 ms (-20.7%) | -0.293 ms (-22.9%) | +424.5 writes/s (+30.6%) |

## Every measured run

Latency varies across repetitions on this shared host. Read these rows
alongside the aggregate table before attributing a difference to the
implementation. The signed deltas compare complete repository methods;
they do not isolate admission or deadline costs or remove host variability.

| Run | Writers | Channels | Operation | Variant | p50 / p95 / p99 ms | Writes/s |
| ---: | ---: | ---: | --- | --- | ---: | ---: |
| 1 | 1 | 1 | Create | before | 0.739 / 1.120 / 1.460 | 1266.1 |
| 1 | 1 | 1 | Create | after | 0.578 / 0.835 / 0.980 | 1653.3 |
| 1 | 1 | 1 | Edit | before | 0.529 / 0.828 / 1.292 | 1798.3 |
| 1 | 1 | 1 | Edit | after | 0.455 / 0.680 / 1.056 | 2025.8 |
| 1 | 1 | 1 | React | before | 0.561 / 0.907 / 1.226 | 1678.9 |
| 1 | 1 | 1 | React | after | 0.405 / 0.621 / 0.775 | 2369.5 |
| 1 | 1 | 1 | Delete | before | 0.639 / 0.963 / 1.216 | 1483.0 |
| 1 | 1 | 1 | Delete | after | 0.381 / 0.554 / 0.655 | 2508.2 |
| 1 | 4 | 1 | Create | before | 0.653 / 0.857 / 1.152 | 5900.9 |
| 1 | 4 | 1 | Create | after | 0.572 / 0.864 / 1.042 | 6587.4 |
| 1 | 4 | 1 | Edit | before | 0.463 / 0.598 / 0.760 | 8417.7 |
| 1 | 4 | 1 | Edit | after | 0.565 / 1.049 / 1.338 | 6383.1 |
| 1 | 4 | 1 | React | before | 0.487 / 0.910 / 1.219 | 7417.7 |
| 1 | 4 | 1 | React | after | 0.334 / 0.487 / 0.633 | 11375.5 |
| 1 | 4 | 1 | Delete | before | 0.451 / 0.582 / 1.110 | 8447.7 |
| 1 | 4 | 1 | Delete | after | 0.439 / 0.618 / 0.798 | 8738.9 |
| 1 | 16 | 1 | Create | before | 1.037 / 1.636 / 2.035 | 14324.5 |
| 1 | 16 | 1 | Create | after | 2.364 / 2.728 / 3.239 | 6673.4 |
| 1 | 16 | 1 | Edit | before | 0.936 / 1.287 / 1.448 | 16478.3 |
| 1 | 16 | 1 | Edit | after | 1.703 / 2.267 / 2.841 | 8996.5 |
| 1 | 16 | 1 | React | before | 0.704 / 0.938 / 1.208 | 21099.5 |
| 1 | 16 | 1 | React | after | 1.320 / 1.533 / 1.942 | 11873.1 |
| 1 | 16 | 1 | Delete | before | 0.926 / 1.304 / 1.527 | 16460.7 |
| 1 | 16 | 1 | Delete | after | 1.681 / 2.248 / 2.656 | 9132.3 |
| 1 | 16 | 16 | Create | before | 1.169 / 1.523 / 1.699 | 13327.9 |
| 1 | 16 | 16 | Create | after | 0.955 / 1.320 / 1.694 | 16082.6 |
| 1 | 16 | 16 | Edit | before | 0.886 / 1.291 / 1.602 | 17007.4 |
| 1 | 16 | 16 | Edit | after | 0.636 / 0.962 / 1.152 | 22957.7 |
| 1 | 16 | 16 | React | before | 0.653 / 1.012 / 1.175 | 22008.7 |
| 1 | 16 | 16 | React | after | 0.567 / 0.849 / 0.965 | 26569.8 |
| 1 | 16 | 16 | Delete | before | 0.884 / 1.391 / 1.694 | 16826.0 |
| 1 | 16 | 16 | Delete | after | 0.579 / 0.899 / 1.157 | 25533.5 |
| 2 | 1 | 1 | Create | before | 1.032 / 1.644 / 2.186 | 906.7 |
| 2 | 1 | 1 | Create | after | 0.779 / 1.077 / 1.268 | 1223.4 |
| 2 | 1 | 1 | Edit | before | 0.541 / 0.727 / 0.866 | 1792.6 |
| 2 | 1 | 1 | Edit | after | 0.692 / 1.099 / 1.578 | 1346.1 |
| 2 | 1 | 1 | React | before | 0.540 / 0.827 / 1.108 | 1745.5 |
| 2 | 1 | 1 | React | after | 0.515 / 0.787 / 0.909 | 1839.2 |
| 2 | 1 | 1 | Delete | before | 0.733 / 1.050 / 1.280 | 1292.3 |
| 2 | 1 | 1 | Delete | after | 0.682 / 1.054 / 1.274 | 1401.4 |
| 2 | 4 | 1 | Create | before | 0.709 / 1.048 / 1.218 | 5336.6 |
| 2 | 4 | 1 | Create | after | 0.583 / 0.845 / 1.079 | 6515.0 |
| 2 | 4 | 1 | Edit | before | 0.533 / 0.692 / 0.834 | 7283.9 |
| 2 | 4 | 1 | Edit | after | 0.520 / 0.729 / 0.887 | 7378.4 |
| 2 | 4 | 1 | React | before | 0.490 / 0.720 / 0.871 | 7819.8 |
| 2 | 4 | 1 | React | after | 0.500 / 0.738 / 0.994 | 7678.8 |
| 2 | 4 | 1 | Delete | before | 0.707 / 1.045 / 2.324 | 5101.9 |
| 2 | 4 | 1 | Delete | after | 0.589 / 0.858 / 1.129 | 6448.3 |
| 2 | 16 | 1 | Create | before | 1.202 / 1.667 / 2.039 | 12671.1 |
| 2 | 16 | 1 | Create | after | 2.883 / 3.282 / 3.471 | 5539.6 |
| 2 | 16 | 1 | Edit | before | 0.922 / 1.365 / 1.588 | 16574.6 |
| 2 | 16 | 1 | Edit | after | 1.978 / 2.829 / 3.352 | 7698.7 |
| 2 | 16 | 1 | React | before | 0.903 / 1.587 / 1.955 | 16228.5 |
| 2 | 16 | 1 | React | after | 1.616 / 2.658 / 2.956 | 8863.7 |
| 2 | 16 | 1 | Delete | before | 1.527 / 2.200 / 2.701 | 10063.6 |
| 2 | 16 | 1 | Delete | after | 3.016 / 4.299 / 4.840 | 5082.2 |
| 2 | 16 | 16 | Create | before | 1.258 / 1.778 / 2.377 | 12156.1 |
| 2 | 16 | 16 | Create | after | 1.153 / 1.614 / 1.893 | 13252.2 |
| 2 | 16 | 16 | Edit | before | 0.838 / 1.356 / 2.191 | 17352.1 |
| 2 | 16 | 16 | Edit | after | 0.561 / 0.862 / 1.032 | 26547.5 |
| 2 | 16 | 16 | React | before | 0.657 / 0.967 / 1.196 | 23052.4 |
| 2 | 16 | 16 | React | after | 0.570 / 0.833 / 1.034 | 26617.4 |
| 2 | 16 | 16 | Delete | before | 0.653 / 0.906 / 1.080 | 23061.0 |
| 2 | 16 | 16 | Delete | after | 0.506 / 0.665 / 0.852 | 30037.5 |
| 3 | 1 | 1 | Create | before | 1.028 / 1.484 / 2.420 | 911.2 |
| 3 | 1 | 1 | Create | after | 1.044 / 1.509 / 1.997 | 918.4 |
| 3 | 1 | 1 | Edit | before | 0.724 / 0.991 / 1.222 | 1355.7 |
| 3 | 1 | 1 | Edit | after | 0.575 / 0.884 / 1.081 | 1644.9 |
| 3 | 1 | 1 | React | before | 0.486 / 0.800 / 0.973 | 1918.0 |
| 3 | 1 | 1 | React | after | 0.528 / 0.857 / 1.069 | 1834.9 |
| 3 | 1 | 1 | Delete | before | 0.685 / 1.001 / 1.300 | 1386.6 |
| 3 | 1 | 1 | Delete | after | 0.521 / 0.794 / 0.987 | 1811.1 |
| 3 | 4 | 1 | Create | before | 0.737 / 0.911 / 1.042 | 5274.5 |
| 3 | 4 | 1 | Create | after | 0.640 / 0.820 / 0.919 | 6124.3 |
| 3 | 4 | 1 | Edit | before | 0.523 / 0.766 / 0.931 | 7270.1 |
| 3 | 4 | 1 | Edit | after | 0.429 / 0.658 / 0.835 | 8728.1 |
| 3 | 4 | 1 | React | before | 0.458 / 0.674 / 0.832 | 8273.2 |
| 3 | 4 | 1 | React | after | 0.381 / 0.577 / 0.739 | 9874.1 |
| 3 | 4 | 1 | Delete | before | 0.603 / 0.906 / 1.175 | 6230.4 |
| 3 | 4 | 1 | Delete | after | 0.687 / 1.050 / 1.280 | 5546.6 |
| 3 | 16 | 1 | Create | before | 0.956 / 1.219 / 1.407 | 16336.3 |
| 3 | 16 | 1 | Create | after | 2.417 / 2.706 / 2.871 | 6580.2 |
| 3 | 16 | 1 | Edit | before | 0.748 / 0.986 / 1.191 | 20799.6 |
| 3 | 16 | 1 | Edit | after | 1.839 / 2.195 / 2.445 | 8549.8 |
| 3 | 16 | 1 | React | before | 0.625 / 0.854 / 1.058 | 24497.0 |
| 3 | 16 | 1 | React | after | 1.734 / 2.160 / 3.065 | 8943.4 |
| 3 | 16 | 1 | Delete | before | 0.911 / 1.317 / 2.045 | 16438.8 |
| 3 | 16 | 1 | Delete | after | 1.761 / 2.234 / 2.545 | 8805.1 |
| 3 | 16 | 16 | Create | before | 0.990 / 1.324 / 1.511 | 15708.4 |
| 3 | 16 | 16 | Create | after | 0.810 / 1.351 / 1.897 | 17757.4 |
| 3 | 16 | 16 | Edit | before | 0.800 / 1.123 / 1.270 | 19134.9 |
| 3 | 16 | 16 | Edit | after | 0.542 / 0.824 / 1.081 | 27351.8 |
| 3 | 16 | 16 | React | before | 0.536 / 0.691 / 0.966 | 28586.0 |
| 3 | 16 | 16 | React | after | 0.411 / 0.559 / 0.893 | 36674.5 |
| 3 | 16 | 16 | Delete | before | 0.603 / 0.788 / 1.021 | 25628.6 |
| 3 | 16 | 16 | Delete | after | 0.469 / 0.646 / 0.962 | 31992.0 |

This report is separate from the historical pre-timeout tables in
[channel_write_latency_results.md](channel_write_latency_results.md).
See [README.md](README.md) for rerun commands.
