# Repository write latency with a total counter deadline

The tested deadline implementation source is `70d9301ff9ed571d2c849624f02a2c4f9fc60802`.
The old repository is pinned to `354da677b5`, including its SQL,
hydration and transaction boundaries. The current channel path adds a
preflight round trip before counter acquisition to set a total 50 ms
statement deadline, preserving any stricter inherited deadline. The
append restores the prior setting within its own statement. These
numbers compare the full old and current repository implementations;
their difference is not an isolated measurement of the preflight cost.

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
| 1 | 1 | Create | 1.902 / 5.339 / 7.717 | 1.457 / 4.078 / 6.612 | 414.9 | 532.4 |
| 1 | 1 | Edit | 1.311 / 3.497 / 5.746 | 0.997 / 2.015 / 2.922 | 612.7 | 901.2 |
| 1 | 1 | React | 0.879 / 2.486 / 5.416 | 0.806 / 1.552 / 2.526 | 910.5 | 1097.1 |
| 1 | 1 | Delete | 1.184 / 2.692 / 4.944 | 1.039 / 2.064 / 3.007 | 695.1 | 864.3 |
| 4 | 1 | Create | 1.360 / 3.062 / 4.690 | 1.203 / 2.369 / 3.532 | 2571.1 | 2932.6 |
| 4 | 1 | Edit | 0.928 / 1.667 / 2.213 | 1.318 / 2.743 / 3.933 | 3935.0 | 2644.1 |
| 4 | 1 | React | 0.821 / 1.465 / 2.014 | 1.167 / 2.485 / 3.620 | 4404.9 | 2945.1 |
| 4 | 1 | Delete | 1.155 / 2.231 / 3.122 | 0.974 / 1.580 / 2.246 | 3062.9 | 3804.5 |
| 16 | 1 | Create | 1.735 / 2.872 / 3.661 | 3.385 / 10.842 / 16.748 | 8578.1 | 3544.6 |
| 16 | 1 | Edit | 1.852 / 3.628 / 4.564 | 2.364 / 9.295 / 15.372 | 7747.8 | 4426.1 |
| 16 | 1 | React | 1.787 / 3.399 / 4.523 | 2.399 / 9.032 / 14.144 | 8077.0 | 4428.9 |
| 16 | 1 | Delete | 2.627 / 5.372 / 9.089 | 2.913 / 12.312 / 17.759 | 5300.6 | 3718.1 |
| 16 | 16 | Create | 2.482 / 4.505 / 5.351 | 2.494 / 4.459 / 5.553 | 5945.4 | 5789.3 |
| 16 | 16 | Edit | 2.298 / 5.095 / 6.579 | 1.508 / 3.042 / 4.216 | 6356.5 | 9305.2 |
| 16 | 16 | React | 1.699 / 3.810 / 5.570 | 1.740 / 3.241 / 5.032 | 7707.4 | 8168.3 |
| 16 | 16 | Delete | 2.082 / 4.815 / 6.257 | 2.023 / 4.750 / 5.848 | 6157.6 | 6523.2 |

## Single-writer change

Each delta is current minus old, calculated from the medians shown above.
Positive latency values mean slower writes; negative values mean faster
writes. Percent changes use the old latency as the denominator.

| Operation | p50 delta | p95 delta | p99 delta | Throughput delta |
| --- | ---: | ---: | ---: | ---: |
| Create | -0.445 ms (-23.4%) | -1.261 ms (-23.6%) | -1.105 ms (-14.3%) | +117.5 writes/s (+28.3%) |
| Edit | -0.314 ms (-24.0%) | -1.482 ms (-42.4%) | -2.824 ms (-49.1%) | +288.5 writes/s (+47.1%) |
| React | -0.073 ms (-8.3%) | -0.934 ms (-37.6%) | -2.890 ms (-53.4%) | +186.6 writes/s (+20.5%) |
| Delete | -0.145 ms (-12.2%) | -0.628 ms (-23.3%) | -1.937 ms (-39.2%) | +169.2 writes/s (+24.3%) |

## Every measured run

Latency varies across repetitions on this shared host. Read these rows
alongside the aggregate table before attributing a difference to the
implementation. The signed deltas compare complete repository methods;
they do not isolate the deadline preflight or remove host variability.

| Run | Writers | Channels | Operation | Variant | p50 / p95 / p99 ms | Writes/s |
| ---: | ---: | ---: | --- | --- | ---: | ---: |
| 1 | 1 | 1 | Create | before | 1.309 / 2.802 / 4.804 | 652.7 |
| 1 | 1 | 1 | Create | after | 1.139 / 1.988 / 3.178 | 794.9 |
| 1 | 1 | 1 | Edit | before | 0.979 / 2.424 / 4.488 | 822.3 |
| 1 | 1 | 1 | Edit | after | 0.997 / 1.728 / 2.373 | 922.7 |
| 1 | 1 | 1 | React | before | 0.858 / 2.486 / 5.416 | 910.5 |
| 1 | 1 | 1 | React | after | 0.775 / 1.391 / 2.034 | 1198.6 |
| 1 | 1 | 1 | Delete | before | 0.966 / 1.847 / 2.638 | 941.5 |
| 1 | 1 | 1 | Delete | after | 0.890 / 1.661 / 2.749 | 1020.5 |
| 1 | 4 | 1 | Create | before | 1.184 / 3.062 / 4.690 | 2721.9 |
| 1 | 4 | 1 | Create | after | 1.134 / 2.347 / 3.073 | 3081.7 |
| 1 | 4 | 1 | Edit | before | 0.545 / 0.789 / 1.046 | 7012.1 |
| 1 | 4 | 1 | Edit | after | 0.607 / 1.132 / 1.974 | 5760.6 |
| 1 | 4 | 1 | React | before | 0.671 / 1.247 / 1.729 | 5339.1 |
| 1 | 4 | 1 | React | after | 0.840 / 1.969 / 2.972 | 3945.3 |
| 1 | 4 | 1 | Delete | before | 0.948 / 2.006 / 2.972 | 3654.0 |
| 1 | 4 | 1 | Delete | after | 0.695 / 1.228 / 1.682 | 5217.0 |
| 1 | 16 | 1 | Create | before | 1.735 / 2.872 / 3.661 | 8578.1 |
| 1 | 16 | 1 | Create | after | 2.384 / 8.190 / 12.782 | 4713.4 |
| 1 | 16 | 1 | Edit | before | 1.570 / 2.423 / 2.844 | 9590.9 |
| 1 | 16 | 1 | Edit | after | 2.094 / 7.986 / 12.372 | 5162.8 |
| 1 | 16 | 1 | React | before | 1.787 / 3.366 / 4.523 | 8077.0 |
| 1 | 16 | 1 | React | after | 1.990 / 8.605 / 13.468 | 5117.6 |
| 1 | 16 | 1 | Delete | before | 1.585 / 2.415 / 2.978 | 9683.9 |
| 1 | 16 | 1 | Delete | after | 1.803 / 7.402 / 12.604 | 5816.6 |
| 1 | 16 | 16 | Create | before | 2.070 / 3.161 / 4.123 | 7165.7 |
| 1 | 16 | 16 | Create | after | 1.902 / 3.041 / 3.775 | 7665.2 |
| 1 | 16 | 16 | Edit | before | 2.298 / 4.269 / 5.454 | 6356.5 |
| 1 | 16 | 16 | Edit | after | 1.373 / 2.293 / 2.807 | 10870.6 |
| 1 | 16 | 16 | React | before | 1.685 / 2.878 / 3.516 | 8767.4 |
| 1 | 16 | 16 | React | after | 1.740 / 3.241 / 4.072 | 8255.8 |
| 1 | 16 | 16 | Delete | before | 2.082 / 5.289 / 7.292 | 6157.6 |
| 1 | 16 | 16 | Delete | after | 2.023 / 5.138 / 7.144 | 6523.2 |
| 2 | 1 | 1 | Create | before | 1.947 / 6.572 / 10.116 | 376.0 |
| 2 | 1 | 1 | Create | after | 1.457 / 4.078 / 6.612 | 532.4 |
| 2 | 1 | 1 | Edit | before | 1.356 / 3.809 / 5.746 | 583.1 |
| 2 | 1 | 1 | Edit | after | 1.486 / 4.681 / 8.275 | 501.9 |
| 2 | 1 | 1 | React | before | 1.278 / 4.490 / 7.707 | 554.2 |
| 2 | 1 | 1 | React | after | 0.983 / 3.011 / 5.512 | 745.6 |
| 2 | 1 | 1 | Delete | before | 1.184 / 3.158 / 5.035 | 673.3 |
| 2 | 1 | 1 | Delete | after | 1.104 / 3.005 / 4.577 | 720.7 |
| 2 | 4 | 1 | Create | before | 1.360 / 2.859 / 3.795 | 2571.1 |
| 2 | 4 | 1 | Create | after | 1.203 / 2.369 / 3.532 | 2932.6 |
| 2 | 4 | 1 | Edit | before | 0.928 / 1.667 / 2.213 | 3935.0 |
| 2 | 4 | 1 | Edit | after | 1.318 / 2.743 / 3.933 | 2644.1 |
| 2 | 4 | 1 | React | before | 0.821 / 1.465 / 2.014 | 4404.9 |
| 2 | 4 | 1 | React | after | 1.167 / 2.485 / 3.620 | 2945.1 |
| 2 | 4 | 1 | Delete | before | 1.155 / 2.231 / 3.122 | 3062.9 |
| 2 | 4 | 1 | Delete | after | 0.974 / 1.580 / 2.246 | 3804.5 |
| 2 | 16 | 1 | Create | before | 1.666 / 2.599 / 3.066 | 9084.9 |
| 2 | 16 | 1 | Create | after | 3.385 / 10.842 / 16.748 | 3544.6 |
| 2 | 16 | 1 | Edit | before | 1.852 / 3.628 / 4.564 | 7747.8 |
| 2 | 16 | 1 | Edit | after | 2.364 / 9.295 / 15.372 | 4426.1 |
| 2 | 16 | 1 | React | before | 1.745 / 3.399 / 4.456 | 8179.7 |
| 2 | 16 | 1 | React | after | 2.399 / 9.032 / 14.144 | 4428.9 |
| 2 | 16 | 1 | Delete | before | 2.627 / 5.372 / 9.089 | 5300.6 |
| 2 | 16 | 1 | Delete | after | 2.913 / 12.312 / 17.759 | 3718.1 |
| 2 | 16 | 16 | Create | before | 2.482 / 4.505 / 5.351 | 5945.4 |
| 2 | 16 | 16 | Create | after | 2.494 / 4.459 / 5.553 | 5789.3 |
| 2 | 16 | 16 | Edit | before | 2.154 / 5.095 / 6.579 | 6360.7 |
| 2 | 16 | 16 | Edit | after | 1.508 / 3.042 / 4.216 | 9305.2 |
| 2 | 16 | 16 | React | before | 1.699 / 3.810 / 5.570 | 7707.4 |
| 2 | 16 | 16 | React | after | 1.707 / 3.222 / 5.032 | 8168.3 |
| 2 | 16 | 16 | Delete | before | 1.438 / 2.867 / 3.982 | 9759.2 |
| 2 | 16 | 16 | Delete | after | 1.403 / 2.408 / 3.113 | 10514.8 |
| 3 | 1 | 1 | Create | before | 1.902 / 5.339 / 7.717 | 414.9 |
| 3 | 1 | 1 | Create | after | 1.525 / 4.376 / 7.052 | 506.9 |
| 3 | 1 | 1 | Edit | before | 1.311 / 3.497 / 5.751 | 612.7 |
| 3 | 1 | 1 | Edit | after | 0.967 / 2.015 / 2.922 | 901.2 |
| 3 | 1 | 1 | React | before | 0.879 / 1.665 / 2.549 | 1013.4 |
| 3 | 1 | 1 | React | after | 0.806 / 1.552 / 2.526 | 1097.1 |
| 3 | 1 | 1 | Delete | before | 1.189 / 2.692 / 4.944 | 695.1 |
| 3 | 1 | 1 | Delete | after | 1.039 / 2.064 / 3.007 | 864.3 |
| 3 | 4 | 1 | Create | before | 1.917 / 4.537 / 7.020 | 1714.8 |
| 3 | 4 | 1 | Create | after | 2.277 / 5.271 / 7.690 | 1489.4 |
| 3 | 4 | 1 | Edit | before | 1.508 / 4.110 / 6.065 | 2089.6 |
| 3 | 4 | 1 | Edit | after | 1.664 / 4.404 / 6.040 | 1982.1 |
| 3 | 4 | 1 | React | before | 1.710 / 4.245 / 5.961 | 1934.0 |
| 3 | 4 | 1 | React | after | 1.494 / 4.650 / 6.275 | 2032.1 |
| 3 | 4 | 1 | Delete | before | 1.557 / 4.453 / 7.435 | 1975.0 |
| 3 | 4 | 1 | Delete | after | 1.633 / 4.002 / 6.108 | 2054.5 |
| 3 | 16 | 1 | Create | before | 3.177 / 6.417 / 8.112 | 4356.2 |
| 3 | 16 | 1 | Create | after | 6.352 / 16.887 / 23.433 | 2023.8 |
| 3 | 16 | 1 | Edit | before | 4.463 / 10.174 / 14.876 | 3012.6 |
| 3 | 16 | 1 | Edit | after | 3.061 / 12.130 / 18.560 | 3584.2 |
| 3 | 16 | 1 | React | before | 2.889 / 5.168 / 7.750 | 5021.9 |
| 3 | 16 | 1 | React | after | 3.707 / 14.794 / 23.326 | 2884.0 |
| 3 | 16 | 1 | Delete | before | 3.661 / 8.520 / 10.589 | 3715.5 |
| 3 | 16 | 1 | Delete | after | 4.228 / 14.563 / 22.935 | 2687.5 |
| 3 | 16 | 16 | Create | before | 4.401 / 7.677 / 9.474 | 3360.1 |
| 3 | 16 | 16 | Create | after | 3.285 / 6.390 / 8.125 | 4385.5 |
| 3 | 16 | 16 | Edit | before | 3.500 / 6.670 / 8.254 | 4085.9 |
| 3 | 16 | 16 | Edit | after | 3.148 / 6.346 / 8.233 | 4367.0 |
| 3 | 16 | 16 | React | before | 2.441 / 5.251 / 7.436 | 5637.1 |
| 3 | 16 | 16 | React | after | 2.113 / 5.215 / 7.741 | 6184.2 |
| 3 | 16 | 16 | Delete | before | 2.310 / 4.815 / 6.257 | 5763.2 |
| 3 | 16 | 16 | Delete | after | 2.385 / 4.750 / 5.848 | 5890.7 |

This report is separate from the historical pre-timeout tables in
[channel_write_latency_results.md](channel_write_latency_results.md).
See [README.md](README.md) for rerun commands.
