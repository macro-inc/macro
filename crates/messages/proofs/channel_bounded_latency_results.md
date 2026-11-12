# Current-repository below-ceiling write results

Tested deadline implementation source: `70d9301ff9ed571d2c849624f02a2c4f9fc60802`.

Release build, sixteen Tokio workers and sixteen connections, one channel,
three repetitions of 2,000 measured mixed writes per case (500 each of
create, edit, react and delete). All connections are opened before timing.
Each case first performs 128 separately reported sequential warmup writes.
Fixture creation, warmup and cleanup are outside the measured batch.

The `deadline50ms` label identifies a total 50 ms counter-allocation
statement deadline, preserving a stricter inherited statement timeout.
One preflight round trip sets it before counter acquisition; the append
restores the prior setting in-statement. No-hold cases
call the current repository directly. Delayed cases call the audited
current-method copies with a requested 2 or 5 ms sleep after the final
statement and before COMMIT. There are no automatic retries.

Fixed arrivals retain their original timestamps independently of
completion, including when they must queue for one of sixteen workers.
Arrival latency includes scheduler lateness, admission and pool waits,
repository execution and commit acknowledgement. Closed-loop latency
starts at each repository call. Rates include draining all requests.

Recorded environment: dedicated local PostgreSQL 18.4 with data on tmpfs,
fsync and synchronous_commit enabled; this worktree's compiler, plan jobs
and tests idle during timing. The host is shared with other worktrees.
This synthetic hold is not a measurement of production commit latency.

Measured requests: **42,000**. Warmup requests: **2,688**.
Measured errors: **0**. Errors including warmup: **0**.
The no-error criterion passes only when both totals are zero. Every
failed attempt remains in the latency and error counts.

## Per-run measurements

| Label | Run | Hold ms | Mode / offered writes/s | Successes / attempts | Errors | Arrival p50 / p95 / p99 ms | Failed p50 / p95 / p99 ms | Successful writes/s | Actual hold p50 / p95 / p99 ms |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| deadline50ms | 1 | 0.000 | closed_loop / - | 2000 / 2000 | 0 | 1.763 / 5.531 / 7.996 | NA / NA / NA | 6641.3 | 0.000 / 0.000 / 0.000 |
| deadline50ms | 1 | 0.000 | open_loop / 1000 | 2000 / 2000 | 0 | 1.206 / 2.244 / 4.624 | NA / NA / NA | 999.8 | 0.000 / 0.000 / 0.000 |
| deadline50ms | 1 | 0.000 | open_loop / 3000 | 2000 / 2000 | 0 | 1.607 / 2.730 / 3.059 | NA / NA / NA | 2891.5 | 0.000 / 0.000 / 0.000 |
| deadline50ms | 1 | 2.000 | open_loop / 200 | 2000 / 2000 | 0 | 4.663 / 5.373 / 7.241 | NA / NA / NA | 200.0 | 3.061 / 3.077 / 3.642 |
| deadline50ms | 1 | 5.000 | open_loop / 20 | 2000 / 2000 | 0 | 8.602 / 10.254 / 15.083 | NA / NA / NA | 20.0 | 6.065 / 6.124 / 7.280 |
| deadline50ms | 1 | 5.000 | open_loop / 50 | 2000 / 2000 | 0 | 8.670 / 9.508 / 10.908 | NA / NA / NA | 50.0 | 6.064 / 6.118 / 6.510 |
| deadline50ms | 1 | 5.000 | open_loop / 100 | 2000 / 2000 | 0 | 7.940 / 8.681 / 11.125 | NA / NA / NA | 100.0 | 6.063 / 6.117 / 6.655 |
| deadline50ms | 2 | 0.000 | closed_loop / - | 2000 / 2000 | 0 | 1.480 / 5.712 / 8.160 | NA / NA / NA | 7097.6 | 0.000 / 0.000 / 0.000 |
| deadline50ms | 2 | 0.000 | open_loop / 1000 | 2000 / 2000 | 0 | 1.892 / 2.680 / 3.059 | NA / NA / NA | 999.6 | 0.000 / 0.000 / 0.000 |
| deadline50ms | 2 | 0.000 | open_loop / 3000 | 2000 / 2000 | 0 | 1.557 / 2.663 / 3.470 | NA / NA / NA | 2990.7 | 0.000 / 0.000 / 0.000 |
| deadline50ms | 2 | 2.000 | open_loop / 200 | 2000 / 2000 | 0 | 5.270 / 6.050 / 8.339 | NA / NA / NA | 200.0 | 3.061 / 3.094 / 3.383 |
| deadline50ms | 2 | 5.000 | open_loop / 20 | 2000 / 2000 | 0 | 8.617 / 9.468 / 10.984 | NA / NA / NA | 20.0 | 6.066 / 6.119 / 6.272 |
| deadline50ms | 2 | 5.000 | open_loop / 50 | 2000 / 2000 | 0 | 8.791 / 9.827 / 12.126 | NA / NA / NA | 50.0 | 6.071 / 6.128 / 6.974 |
| deadline50ms | 2 | 5.000 | open_loop / 100 | 2000 / 2000 | 0 | 7.979 / 9.990 / 12.612 | NA / NA / NA | 100.0 | 6.071 / 6.240 / 7.584 |
| deadline50ms | 3 | 0.000 | closed_loop / - | 2000 / 2000 | 0 | 1.599 / 6.277 / 9.671 | NA / NA / NA | 6262.5 | 0.000 / 0.000 / 0.000 |
| deadline50ms | 3 | 0.000 | open_loop / 1000 | 2000 / 2000 | 0 | 1.307 / 2.352 / 4.391 | NA / NA / NA | 999.5 | 0.000 / 0.000 / 0.000 |
| deadline50ms | 3 | 0.000 | open_loop / 3000 | 2000 / 2000 | 0 | 1.865 / 14.301 / 21.847 | NA / NA / NA | 2992.4 | 0.000 / 0.000 / 0.000 |
| deadline50ms | 3 | 2.000 | open_loop / 200 | 2000 / 2000 | 0 | 5.203 / 7.820 / 13.952 | NA / NA / NA | 200.0 | 3.067 / 3.357 / 4.113 |
| deadline50ms | 3 | 5.000 | open_loop / 20 | 2000 / 2000 | 0 | 8.653 / 9.608 / 11.631 | NA / NA / NA | 20.0 | 6.068 / 6.126 / 6.950 |
| deadline50ms | 3 | 5.000 | open_loop / 50 | 2000 / 2000 | 0 | 8.696 / 9.545 / 10.978 | NA / NA / NA | 50.0 | 6.070 / 6.125 / 6.356 |
| deadline50ms | 3 | 5.000 | open_loop / 100 | 2000 / 2000 | 0 | 8.644 / 9.450 / 10.817 | NA / NA / NA | 100.0 | 6.068 / 6.125 / 6.263 |

## Three-run comparison

Latency and rate values are medians of per-run values, not percentiles
from pooled samples. Error counts are totals across all three runs.

| Label | Hold ms | Mode / offered writes/s | Errors | Arrival p50 / p95 / p99 ms | Successful writes/s |
| --- | ---: | --- | ---: | ---: | ---: |
| deadline50ms | 0.000 | closed_loop / - | 0 | 1.599 / 5.712 / 8.160 | 6641.300 |
| deadline50ms | 0.000 | open_loop / 1000 | 0 | 1.307 / 2.352 / 4.391 | 999.600 |
| deadline50ms | 0.000 | open_loop / 3000 | 0 | 1.607 / 2.730 / 3.470 | 2990.700 |
| deadline50ms | 2.000 | open_loop / 200 | 0 | 5.203 / 6.050 / 8.339 | 200.000 |
| deadline50ms | 5.000 | open_loop / 20 | 0 | 8.617 / 9.608 / 11.631 | 20.000 |
| deadline50ms | 5.000 | open_loop / 50 | 0 | 8.696 / 9.545 / 10.978 | 50.000 |
| deadline50ms | 5.000 | open_loop / 100 | 0 | 7.979 / 9.450 / 11.125 | 100.000 |

## Errors, including warmup

`55P03` includes both `Repository` and `Contended` errors; `57014` means
query cancellation, `40P01` deadlock. The CSV retains successful-only
arrival, all-attempt service latency, and every raw error category.

| Label | Run | Phase | Hold ms | Offered writes/s | Pool timeout | 55P03 | 57014 | 40P01 | Other |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| deadline50ms | 1 | warmup | 0.000 | - | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 1 | measured | 0.000 | - | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 1 | warmup | 0.000 | 1000 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 1 | measured | 0.000 | 1000 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 1 | warmup | 0.000 | 3000 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 1 | measured | 0.000 | 3000 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 1 | warmup | 2.000 | 200 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 1 | measured | 2.000 | 200 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 1 | warmup | 5.000 | 20 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 1 | measured | 5.000 | 20 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 1 | warmup | 5.000 | 50 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 1 | measured | 5.000 | 50 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 1 | warmup | 5.000 | 100 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 1 | measured | 5.000 | 100 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 2 | warmup | 0.000 | - | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 2 | measured | 0.000 | - | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 2 | warmup | 0.000 | 1000 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 2 | measured | 0.000 | 1000 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 2 | warmup | 0.000 | 3000 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 2 | measured | 0.000 | 3000 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 2 | warmup | 2.000 | 200 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 2 | measured | 2.000 | 200 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 2 | warmup | 5.000 | 20 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 2 | measured | 5.000 | 20 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 2 | warmup | 5.000 | 50 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 2 | measured | 5.000 | 50 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 2 | warmup | 5.000 | 100 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 2 | measured | 5.000 | 100 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 3 | warmup | 0.000 | - | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 3 | measured | 0.000 | - | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 3 | warmup | 0.000 | 1000 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 3 | measured | 0.000 | 1000 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 3 | warmup | 0.000 | 3000 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 3 | measured | 0.000 | 3000 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 3 | warmup | 2.000 | 200 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 3 | measured | 2.000 | 200 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 3 | warmup | 5.000 | 20 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 3 | measured | 5.000 | 20 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 3 | warmup | 5.000 | 50 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 3 | measured | 5.000 | 50 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 3 | warmup | 5.000 | 100 | 0 | 0 | 0 | 0 | 0 |
| deadline50ms | 3 | measured | 5.000 | 100 | 0 | 0 | 0 | 0 | 0 |

See [README.md](README.md) for the benchmark and parser commands.
