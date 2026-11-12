# Repository write latency

Measured on an isolated local PostgreSQL 18.4 server with synchronous commit and fsync enabled. Old and new repository methods ran back to back on the same database. `SQLX_OFFLINE` was unset. This worktree’s compilation, query-plan jobs and other validation work were idle during each timed run. Setup, warmup and cleanup are outside measured batches.

The baseline retains the SQL, hydration and transaction boundaries from `354da677b5`. Each runtime/profile/layout/operation/variant has three runs of 2,000 measured writes, preceded by 128 warmups. The rows below are medians of the three reported percentiles/throughputs, not percentiles pooled across runs. [Every run](channel_write_latency_runs.csv) retains p50/p95/p99, wall time and throughput so variation is visible.

`multi_thread_16` uses an explicit 16-worker Tokio runtime and creates its pool there. `current_thread` retains the SQLx test runtime; it is reported separately rather than mixed with server-style execution. Both use identical SQL and workloads.

The latency gate is not met: 16 concurrent writers in one channel have higher p95 and lower throughput under the 16-worker runtime, despite faster writes without channel contention. The counter/log statement remains the final statement before commit.

## multi_thread_16, debug

All durations are milliseconds. Percentile columns are p50 / p95 / p99.

| Writers | Channels | Operation | Before ms | After ms | Before ops/s | After ops/s | Before p95 runs | After p95 runs |
| ---: | ---: | --- | --- | --- | ---: | ---: | --- | --- |
| 1 | 1 | Create | 0.983 / 1.354 / 1.593 | 0.797 / 1.121 / 1.282 | 971.1 | 1212.8 | 1.354 / 1.367 / 1.198 | 1.121 / 1.162 / 1.046 |
| 1 | 1 | Edit | 0.792 / 1.038 / 1.150 | 0.551 / 0.773 / 0.880 | 1226.6 | 1747.7 | 0.941 / 1.177 / 1.038 | 0.738 / 0.773 / 0.773 |
| 1 | 1 | React | 0.751 / 0.991 / 1.197 | 0.505 / 0.761 / 0.919 | 1291.0 | 1881.4 | 0.928 / 1.147 / 0.991 | 0.780 / 0.677 / 0.761 |
| 1 | 1 | Delete | 0.916 / 1.247 / 1.485 | 0.644 / 0.892 / 1.112 | 1052.9 | 1487.0 | 1.486 / 1.209 / 1.247 | 0.878 / 0.957 / 0.892 |
| 4 | 1 | Create | 1.100 / 1.401 / 1.625 | 0.921 / 1.193 / 1.318 | 3525.4 | 4265.7 | 1.393 / 1.426 / 1.401 | 1.193 / 1.315 / 1.082 |
| 4 | 1 | Edit | 0.870 / 1.110 / 1.243 | 0.778 / 1.144 / 1.412 | 4525.7 | 4958.6 | 1.110 / 1.246 / 1.031 | 1.144 / 1.147 / 0.881 |
| 4 | 1 | React | 0.825 / 1.105 / 1.324 | 0.615 / 0.861 / 1.011 | 4727.1 | 6338.6 | 1.105 / 1.284 / 0.938 | 0.861 / 1.010 / 0.788 |
| 4 | 1 | Delete | 0.883 / 1.112 / 1.269 | 0.679 / 0.906 / 1.045 | 4442.6 | 5761.9 | 1.112 / 1.179 / 1.106 | 0.906 / 0.980 / 0.897 |
| 16 | 1 | Create | 1.476 / 1.756 / 1.991 | 2.021 / 5.350 / 8.337 | 10625.8 | 6166.1 | 2.092 / 1.756 / 1.751 | 5.632 / 5.350 / 5.159 |
| 16 | 1 | Edit | 1.216 / 1.487 / 1.748 | 1.725 / 5.543 / 8.339 | 12974.5 | 6639.9 | 1.944 / 1.428 / 1.487 | 5.970 / 5.543 / 5.417 |
| 16 | 1 | React | 1.139 / 1.415 / 1.820 | 1.521 / 5.835 / 8.667 | 13644.5 | 7105.5 | 1.519 / 1.415 / 1.343 | 5.835 / 5.836 / 5.179 |
| 16 | 1 | Delete | 1.289 / 1.644 / 2.127 | 1.630 / 5.445 / 8.372 | 12018.7 | 6800.4 | 1.686 / 1.644 / 1.603 | 6.708 / 5.445 / 5.371 |
| 16 | 16 | Create | 1.671 / 2.136 / 2.490 | 1.301 / 1.604 / 1.875 | 9196.0 | 11918.5 | 2.136 / 2.190 / 1.799 | 1.604 / 1.654 / 1.433 |
| 16 | 16 | Edit | 1.326 / 1.911 / 2.278 | 0.927 / 1.203 / 1.521 | 11231.9 | 16625.0 | 1.982 / 1.911 / 1.443 | 1.303 / 1.203 / 1.158 |
| 16 | 16 | React | 1.102 / 1.369 / 1.648 | 0.829 / 1.073 / 1.304 | 14057.7 | 18747.4 | 1.440 / 1.369 / 1.316 | 1.073 / 1.043 / 1.277 |
| 16 | 16 | Delete | 1.242 / 1.491 / 1.733 | 0.826 / 1.071 / 1.491 | 12554.4 | 18791.8 | 1.586 / 1.491 / 1.485 | 1.041 / 1.071 / 1.315 |

## multi_thread_16, release

All durations are milliseconds. Percentile columns are p50 / p95 / p99.

| Writers | Channels | Operation | Before ms | After ms | Before ops/s | After ops/s | Before p95 runs | After p95 runs |
| ---: | ---: | --- | --- | --- | ---: | ---: | --- | --- |
| 1 | 1 | Create | 0.608 / 0.841 / 1.015 | 0.522 / 0.686 / 0.816 | 1604.2 | 1842.1 | 0.841 / 0.918 / 0.766 | 0.655 / 0.686 / 0.749 |
| 1 | 1 | Edit | 0.443 / 0.636 / 0.718 | 0.452 / 0.789 / 1.013 | 2175.6 | 2020.8 | 0.518 / 0.925 / 0.636 | 0.430 / 0.789 / 0.791 |
| 1 | 1 | React | 0.458 / 0.640 / 0.732 | 0.354 / 0.632 / 0.810 | 2131.2 | 2265.9 | 0.361 / 0.817 / 0.640 | 0.510 / 0.632 / 4.516 |
| 1 | 1 | Delete | 0.640 / 0.933 / 1.135 | 0.485 / 0.659 / 0.800 | 1495.7 | 2010.1 | 0.503 / 0.933 / 9.209 | 0.375 / 0.796 / 0.659 |
| 4 | 1 | Create | 0.646 / 0.819 / 0.955 | 0.557 / 0.717 / 0.835 | 5972.7 | 7046.8 | 0.657 / 0.819 / 0.846 | 0.564 / 0.843 / 0.717 |
| 4 | 1 | Edit | 0.453 / 0.597 / 0.748 | 0.380 / 0.536 / 0.655 | 8616.9 | 10125.1 | 0.502 / 0.758 / 0.597 | 0.462 / 0.541 / 0.536 |
| 4 | 1 | React | 0.416 / 0.573 / 0.699 | 0.334 / 0.516 / 0.652 | 9359.5 | 11266.7 | 0.588 / 0.550 / 0.573 | 0.412 / 0.516 / 0.612 |
| 4 | 1 | Delete | 0.471 / 0.612 / 0.765 | 0.387 / 0.514 / 0.616 | 8253.3 | 10079.0 | 0.503 / 0.612 / 0.797 | 0.442 / 0.514 / 0.531 |
| 16 | 1 | Create | 0.968 / 1.364 / 1.606 | 1.206 / 4.138 / 5.916 | 15854.6 | 9059.3 | 1.364 / 1.416 / 1.170 | 4.426 / 4.035 / 4.138 |
| 16 | 1 | Edit | 0.860 / 1.201 / 1.614 | 1.083 / 4.091 / 6.274 | 17655.1 | 9967.5 | 1.201 / 1.136 / 1.381 | 3.960 / 4.091 / 4.280 |
| 16 | 1 | React | 0.797 / 1.069 / 1.197 | 0.957 / 4.118 / 6.281 | 19366.5 | 10475.5 | 1.037 / 1.131 / 1.069 | 4.052 / 4.118 / 4.219 |
| 16 | 1 | Delete | 0.921 / 1.253 / 1.429 | 1.083 / 4.310 / 7.012 | 16765.5 | 9634.4 | 1.085 / 1.253 / 1.472 | 3.513 / 4.815 / 4.310 |
| 16 | 16 | Create | 1.247 / 1.664 / 1.888 | 0.942 / 1.290 / 1.474 | 12139.2 | 16328.6 | 1.519 / 1.664 / 1.805 | 1.225 / 1.290 / 1.356 |
| 16 | 16 | Edit | 0.861 / 1.122 / 1.281 | 0.681 / 1.113 / 1.511 | 18048.0 | 21210.2 | 1.072 / 1.122 / 1.146 | 1.113 / 1.188 / 1.013 |
| 16 | 16 | React | 0.754 / 1.016 / 1.185 | 0.614 / 0.898 / 1.082 | 20446.7 | 24634.9 | 0.938 / 1.016 / 1.076 | 0.764 / 0.899 / 0.898 |
| 16 | 16 | Delete | 0.859 / 1.186 / 1.376 | 0.645 / 0.888 / 1.031 | 17677.2 | 23790.9 | 1.224 / 1.168 / 1.186 | 0.881 / 0.893 / 0.888 |

## current_thread, debug

All durations are milliseconds. Percentile columns are p50 / p95 / p99.

| Writers | Channels | Operation | Before ms | After ms | Before ops/s | After ops/s | Before p95 runs | After p95 runs |
| ---: | ---: | --- | --- | --- | ---: | ---: | --- | --- |
| 1 | 1 | Create | 1.217 / 1.583 / 1.787 | 0.951 / 1.319 / 1.644 | 803.0 | 1014.4 | 1.468 / 1.583 / 1.783 | 1.314 / 1.319 / 1.373 |
| 1 | 1 | Edit | 0.789 / 1.094 / 1.280 | 0.582 / 0.828 / 0.996 | 1248.9 | 1644.2 | 1.094 / 1.234 / 1.076 | 0.787 / 0.828 / 0.889 |
| 1 | 1 | React | 0.665 / 0.908 / 1.042 | 0.510 / 0.775 / 0.944 | 1450.3 | 1871.3 | 0.858 / 1.010 / 0.908 | 0.775 / 0.758 / 1.271 |
| 1 | 1 | Delete | 0.837 / 1.198 / 1.402 | 0.659 / 1.032 / 1.221 | 1132.9 | 1426.0 | 1.099 / 1.198 / 1.282 | 0.758 / 1.032 / 1.067 |
| 4 | 1 | Create | 1.509 / 2.051 / 2.358 | 1.138 / 1.553 / 1.755 | 2557.2 | 3390.9 | 2.023 / 2.051 / 2.193 | 1.540 / 1.553 / 1.653 |
| 4 | 1 | Edit | 1.221 / 1.618 / 1.766 | 0.891 / 1.246 / 1.548 | 3187.7 | 4303.9 | 1.618 / 1.382 / 1.795 | 1.203 / 1.246 / 1.347 |
| 4 | 1 | React | 1.133 / 1.408 / 1.587 | 0.839 / 1.240 / 1.494 | 3460.1 | 4536.8 | 1.408 / 1.351 / 1.585 | 1.223 / 1.240 / 1.338 |
| 4 | 1 | Delete | 1.262 / 1.687 / 1.946 | 0.886 / 1.310 / 1.461 | 3066.2 | 4328.3 | 1.514 / 1.687 / 1.773 | 1.310 / 1.246 / 1.355 |
| 16 | 1 | Create | 5.883 / 6.503 / 6.703 | 4.367 / 11.008 / 15.803 | 2698.7 | 3003.1 | 6.503 / 6.550 / 6.246 | 11.008 / 11.583 / 10.466 |
| 16 | 1 | Edit | 5.001 / 6.116 / 6.396 | 3.119 / 9.172 / 14.889 | 3069.3 | 3776.9 | 4.653 / 6.504 / 6.116 | 8.023 / 10.577 / 9.172 |
| 16 | 1 | React | 4.779 / 6.944 / 8.624 | 2.613 / 10.054 / 15.299 | 3114.8 | 4045.8 | 4.649 / 6.944 / 7.205 | 7.741 / 11.029 / 10.054 |
| 16 | 1 | Delete | 4.785 / 5.640 / 5.919 | 2.521 / 8.673 / 13.595 | 3227.9 | 4470.9 | 4.592 / 6.427 / 5.640 | 7.827 / 8.673 / 9.554 |
| 16 | 16 | Create | 5.781 / 6.506 / 7.046 | 4.300 / 4.983 / 5.507 | 2747.1 | 3680.2 | 6.462 / 9.049 / 6.506 | 4.954 / 4.983 / 5.216 |
| 16 | 16 | Edit | 4.997 / 5.832 / 6.929 | 3.294 / 4.171 / 4.794 | 3160.5 | 4603.3 | 4.611 / 5.832 / 6.236 | 3.610 / 4.171 / 4.185 |
| 16 | 16 | React | 4.548 / 5.296 / 6.001 | 2.873 / 3.546 / 3.899 | 3467.9 | 5463.1 | 5.205 / 5.711 / 5.296 | 2.913 / 8.291 / 3.546 |
| 16 | 16 | Delete | 4.632 / 5.448 / 5.752 | 3.018 / 3.550 / 3.829 | 3425.2 | 5212.5 | 4.737 / 5.448 / 5.551 | 3.197 / 3.658 / 3.550 |

## current_thread, release

All durations are milliseconds. Percentile columns are p50 / p95 / p99.

| Writers | Channels | Operation | Before ms | After ms | Before ops/s | After ops/s | Before p95 runs | After p95 runs |
| ---: | ---: | --- | --- | --- | ---: | ---: | --- | --- |
| 1 | 1 | Create | 0.889 / 1.206 / 1.382 | 0.678 / 1.032 / 1.426 | 1073.2 | 1426.3 | 0.760 / 1.275 / 1.206 | 1.032 / 1.138 / 0.946 |
| 1 | 1 | Edit | 0.566 / 0.796 / 0.933 | 0.538 / 0.815 / 0.990 | 1731.4 | 1759.8 | 0.699 / 0.883 / 0.796 | 0.635 / 0.815 / 0.823 |
| 1 | 1 | React | 0.525 / 0.783 / 0.940 | 0.380 / 0.610 / 0.801 | 1850.6 | 2484.5 | 0.549 / 0.799 / 0.783 | 0.559 / 0.700 / 0.610 |
| 1 | 1 | Delete | 0.538 / 0.854 / 1.045 | 0.480 / 0.782 / 1.190 | 1751.1 | 1925.1 | 0.862 / 0.820 / 0.854 | 0.740 / 0.782 / 0.896 |
| 4 | 1 | Create | 0.671 / 0.868 / 0.985 | 0.544 / 0.783 / 0.893 | 5828.5 | 6974.4 | 0.868 / 0.966 / 0.796 | 0.783 / 0.782 / 0.846 |
| 4 | 1 | Edit | 0.525 / 0.724 / 0.865 | 0.403 / 0.576 / 0.670 | 7322.1 | 9548.2 | 0.731 / 0.724 / 0.704 | 0.534 / 0.576 / 0.603 |
| 4 | 1 | React | 0.447 / 0.608 / 0.738 | 0.370 / 0.540 / 0.663 | 8781.6 | 10222.7 | 0.562 / 0.608 / 0.636 | 0.530 / 0.540 / 10.761 |
| 4 | 1 | Delete | 0.521 / 0.682 / 0.792 | 0.441 / 0.661 / 0.851 | 7332.2 | 8290.7 | 0.675 / 0.802 / 0.682 | 0.623 / 0.661 / 12.439 |
| 16 | 1 | Create | 2.057 / 2.384 / 2.551 | 1.336 / 4.400 / 6.665 | 7639.9 | 8515.1 | 2.384 / 2.085 / 16.338 | 4.400 / 3.815 / 19.163 |
| 16 | 1 | Edit | 1.764 / 2.053 / 2.473 | 1.107 / 4.219 / 6.641 | 8840.7 | 9748.9 | 2.053 / 1.932 / 2.367 | 4.611 / 3.907 / 4.219 |
| 16 | 1 | React | 1.667 / 1.880 / 2.278 | 1.044 / 4.478 / 6.876 | 9419.3 | 9821.2 | 2.409 / 1.880 / 1.726 | 4.478 / 4.041 / 4.640 |
| 16 | 1 | Delete | 1.679 / 2.040 / 2.194 | 1.148 / 3.892 / 6.169 | 9229.2 | 9943.4 | 2.176 / 2.040 / 1.707 | 3.892 / 4.268 / 3.884 |
| 16 | 16 | Create | 2.106 / 2.667 / 2.849 | 1.634 / 2.019 / 2.160 | 7321.8 | 9614.2 | 2.667 / 2.667 / 2.724 | 1.940 / 2.019 / 2.039 |
| 16 | 16 | Edit | 1.792 / 1.984 / 2.216 | 1.322 / 1.703 / 1.899 | 8802.4 | 11319.3 | 1.984 / 2.499 / 1.845 | 1.703 / 1.750 / 1.642 |
| 16 | 16 | React | 1.644 / 1.888 / 2.063 | 1.143 / 1.335 / 1.445 | 9616.9 | 13724.6 | 1.770 / 2.131 / 1.888 | 1.281 / 1.539 / 1.335 |
| 16 | 16 | Delete | 1.631 / 1.866 / 1.977 | 1.176 / 1.388 / 1.583 | 9744.9 | 13386.4 | 1.817 / 2.142 / 1.866 | 1.388 / 1.518 / 1.323 |

## Commit diagnostic

This separate run enables SQL tracing and reports 2,000 writes per operation/layout. `post-append` is append completion at the client through commit acknowledgement: it excludes server append execution and includes client work, instrumentation and the commit round trip. `queue-inclusive` starts before the counter request, so it includes waiting to acquire the counter. Neither is exact server lock duration. The statement plan and these intervals bound and explain the critical section without claiming a server-side lock timestamp. [Raw diagnostic rows](channel_write_commit_diagnostics.csv) also include p50 and p99.

| Runtime | Profile | Writers | Operation | COMMIT p95 ms | Post-append p95 ms | Queue-inclusive p95 ms |
| --- | --- | ---: | --- | ---: | ---: | ---: |
| current_thread | debug | 1 | Create | 0.069 | 0.082 | 0.208 |
| current_thread | debug | 1 | Edit | 0.046 | 0.057 | 0.176 |
| current_thread | debug | 1 | React | 0.053 | 0.065 | 0.193 |
| current_thread | debug | 1 | Delete | 0.052 | 0.063 | 0.174 |
| current_thread | debug | 16 | Create | 0.325 | 0.334 | 8.361 |
| current_thread | debug | 16 | Edit | 0.273 | 0.284 | 8.520 |
| current_thread | debug | 16 | React | 0.233 | 0.241 | 7.551 |
| current_thread | debug | 16 | Delete | 0.254 | 0.262 | 8.745 |
| current_thread | release | 1 | Create | 0.048 | 0.050 | 0.143 |
| current_thread | release | 1 | Edit | 0.041 | 0.043 | 0.124 |
| current_thread | release | 1 | React | 0.040 | 0.042 | 0.130 |
| current_thread | release | 1 | Delete | 0.038 | 0.039 | 0.131 |
| current_thread | release | 16 | Create | 0.097 | 0.098 | 3.282 |
| current_thread | release | 16 | Edit | 0.080 | 0.081 | 3.268 |
| current_thread | release | 16 | React | 0.082 | 0.085 | 3.578 |
| current_thread | release | 16 | Delete | 0.085 | 0.088 | 3.630 |
| multi_thread_16 | debug | 1 | Create | 0.070 | 0.083 | 0.216 |
| multi_thread_16 | debug | 1 | Edit | 0.061 | 0.073 | 0.202 |
| multi_thread_16 | debug | 1 | React | 0.065 | 0.078 | 0.217 |
| multi_thread_16 | debug | 1 | Delete | 0.065 | 0.078 | 0.212 |
| multi_thread_16 | debug | 16 | Create | 0.160 | 0.177 | 4.976 |
| multi_thread_16 | debug | 16 | Edit | 0.159 | 0.183 | 5.582 |
| multi_thread_16 | debug | 16 | React | 0.153 | 0.171 | 5.809 |
| multi_thread_16 | debug | 16 | Delete | 0.144 | 0.160 | 5.558 |
| multi_thread_16 | release | 1 | Create | 0.040 | 0.042 | 0.114 |
| multi_thread_16 | release | 1 | Edit | 0.040 | 0.041 | 0.136 |
| multi_thread_16 | release | 1 | React | 0.037 | 0.038 | 0.123 |
| multi_thread_16 | release | 1 | Delete | 0.034 | 0.035 | 0.105 |
| multi_thread_16 | release | 16 | Create | 0.097 | 0.101 | 3.260 |
| multi_thread_16 | release | 16 | Edit | 0.084 | 0.088 | 3.228 |
| multi_thread_16 | release | 16 | React | 0.084 | 0.088 | 3.782 |
| multi_thread_16 | release | 16 | Delete | 0.101 | 0.106 | 4.180 |
