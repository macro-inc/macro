# Shared-pool channel isolation results

## Source and environment

The `before` variant always uses the old repository methods pinned to
`354da677b5`, including their original hydration path. The `after`
variant uses the source state identified by its label:

| Label | Current-method source |
| --- | --- |
| baseline | Pre-timeout implementation at `5743b47a10`, plus the shared-pool benchmark harness. |
| bounded5ms | Implementation with the transaction-local 5 ms counter lock-wait timeout, retaining any stricter nonzero inherited timeout. |

The benchmark-only method copies preserve the ordered SQL and add only
the measured sleep and returned duration; verify them with
[the source-equivalence audit](check_delayed_writers.py). Requests call
the repository directly and have no automatic retries. Each error is
one failed request, not a successfully retried operation.

Pool sizing copies the production branch in
[the document storage server](../../../services/document_storage_service/src/server.rs#L245):
minimum 10, maximum 50, with SQLx's default 30-second acquire timeout.
The recorded benchmark settings are checked against those values.

Recorded environment for the `baseline` and `bounded5ms` measurements:
a dedicated local PostgreSQL 18.4 server with data files on tmpfs,
`fsync` and `synchronous_commit` enabled. This worktree's compiler,
query-plan jobs and tests were idle during the timed work. The host
was shared with other worktrees; this was not an isolated-host or
production-disk measurement. These facts are recorded context, not
settings inferred by the parser from the CSV.

## Workload

Release build with sixteen Tokio workers, a shared pool of 10 minimum /
50 maximum connections, and the default 30-second acquire timeout.
All 50 connections were opened before measurement. One hundred writers
each edit a distinct message in the flood channel; independent probes
edit distinct messages in a second channel at five scheduled arrivals
per second. Both repository variants receive a requested 5 ms sleep
after their last SQL statement and before COMMIT. The current variant
holds its channel counter during this artificial interval.

Each case admits work for 30 seconds and retains all
150 scheduled probes. Probe latency starts at the
original scheduled arrival and includes pool waits; flood latency starts
at each repository call. No semaphore precedes the pool. Throughput
includes draining in-flight work. Setup and cleanup are not timed.

Each row below is one run, not an aggregate of percentiles. Attempt
latency includes failed writes. Successful-write latency and observed
sleep duration exclude errors; NA means there were no successful writes.
The sleep is a controlled stress input, not a measured production commit
latency.

| Label | Run | Variant | Lane | Attempts / successes | Attempt p50 / p95 / p99 ms | Success p50 / p95 / p99 ms | Successes/s | Observed 5 ms hold p50 / p95 / p99 ms |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |
| baseline | 1 | before | probe | 150 / 150 | 17.208 / 22.218 / 26.027 | 17.208 / 22.218 / 26.027 | 5.0 | 5.973 / 6.677 / 6.999 |
| baseline | 1 | before | flood | 203715 / 203715 | 14.591 / 16.279 / 18.852 | 14.591 / 16.279 / 18.852 | 6787.5 | 5.972 / 6.739 / 6.964 |
| baseline | 1 | after | probe | 150 / 150 | 330.372 / 340.346 / 343.254 | 330.372 / 340.346 / 343.254 | 4.9 | 6.061 / 6.817 / 6.909 |
| baseline | 1 | after | flood | 4779 / 4779 | 397.123 / 1635.248 / 2505.550 | 397.123 / 1635.248 / 2505.550 | 156.0 | 6.341 / 6.653 / 6.816 |
| baseline | 2 | before | probe | 150 / 150 | 16.416 / 21.312 / 22.789 | 16.416 / 21.312 / 22.789 | 5.0 | 6.074 / 6.797 / 6.899 |
| baseline | 2 | before | flood | 207586 / 207586 | 14.277 / 15.986 / 17.755 | 14.277 / 15.986 / 17.755 | 6915.7 | 5.974 / 6.779 / 6.990 |
| baseline | 2 | after | probe | 150 / 150 | 329.212 / 339.308 / 343.317 | 329.212 / 339.308 / 343.317 | 4.9 | 6.063 / 6.845 / 6.927 |
| baseline | 2 | after | flood | 4798 / 4798 | 415.327 / 1592.131 / 2447.674 | 415.327 / 1592.131 / 2447.674 | 156.7 | 6.367 / 6.600 / 6.740 |
| baseline | 3 | before | probe | 150 / 150 | 16.486 / 20.854 / 22.494 | 16.486 / 20.854 / 22.494 | 5.0 | 6.042 / 6.775 / 7.030 |
| baseline | 3 | before | flood | 207272 / 207272 | 14.280 / 16.002 / 18.045 | 14.280 / 16.002 / 18.045 | 6905.7 | 6.003 / 6.786 / 6.979 |
| baseline | 3 | after | probe | 150 / 150 | 328.560 / 339.137 / 345.584 | 328.560 / 339.137 / 345.584 | 4.9 | 6.061 / 6.797 / 7.053 |
| baseline | 3 | after | flood | 4797 / 4797 | 427.565 / 1559.540 / 2332.325 | 427.565 / 1559.540 / 2332.325 | 156.6 | 6.356 / 6.594 / 6.772 |
| bounded5ms | 1 | before | probe | 150 / 150 | 18.284 / 25.460 / 35.456 | 18.284 / 25.460 / 35.456 | 5.0 | 5.955 / 6.741 / 6.978 |
| bounded5ms | 1 | before | flood | 193278 / 193278 | 14.930 / 18.958 / 28.896 | 14.930 / 18.958 / 28.896 | 6439.8 | 5.912 / 6.707 / 7.339 |
| bounded5ms | 1 | after | probe | 150 / 150 | 15.937 / 44.301 / 60.885 | 15.937 / 44.301 / 60.885 | 5.0 | 5.685 / 6.687 / 6.918 |
| bounded5ms | 1 | after | flood | 198197 / 4735 | 12.172 / 27.661 / 46.745 | 13.122 / 36.661 / 61.536 | 157.7 | 5.790 / 6.084 / 7.975 |
| bounded5ms | 2 | before | probe | 150 / 150 | 16.598 / 21.779 / 22.777 | 16.598 / 21.779 / 22.777 | 5.0 | 6.017 / 6.749 / 6.967 |
| bounded5ms | 2 | before | flood | 204943 / 204943 | 14.430 / 16.331 / 18.311 | 14.430 / 16.331 / 18.311 | 6828.7 | 5.961 / 6.725 / 6.963 |
| bounded5ms | 2 | after | probe | 150 / 150 | 15.589 / 18.630 / 19.844 | 15.589 / 18.630 / 19.844 | 5.0 | 5.619 / 6.042 / 6.565 |
| bounded5ms | 2 | after | flood | 218373 / 4966 | 12.144 / 19.098 / 24.448 | 12.996 / 19.862 / 24.739 | 165.4 | 5.783 / 5.913 / 6.130 |
| bounded5ms | 3 | before | probe | 150 / 150 | 16.694 / 23.964 / 26.445 | 16.694 / 23.964 / 26.445 | 5.0 | 5.975 / 6.857 / 7.457 |
| bounded5ms | 3 | before | flood | 199078 / 199078 | 14.509 / 18.862 / 27.395 | 14.509 / 18.862 / 27.395 | 6632.7 | 5.948 / 6.764 / 7.099 |
| bounded5ms | 3 | after | probe | 150 / 150 | 15.726 / 18.889 / 20.704 | 15.726 / 18.889 / 20.704 | 5.0 | 5.610 / 6.614 / 6.944 |
| bounded5ms | 3 | after | flood | 219088 / 4965 | 12.178 / 18.309 / 23.905 | 13.033 / 19.301 / 24.891 | 165.4 | 5.777 / 5.911 / 6.135 |

## Three-run comparison

Latency and rate columns below are medians of the three per-run values,
not percentiles calculated from pooled samples. Error columns are sums
over all three runs. The per-run tables retain tail variation.

| Label | Variant | Probe attempts | Probe p50 / p95 / p99 ms | Probe errors / pool timeouts / 55P03 | Probe observed hold p50 / p95 / p99 ms |
| --- | --- | ---: | ---: | ---: | ---: |
| baseline | before | 450 | 16.486 / 21.312 / 22.789 | 0 / 0 / 0 | 6.042 / 6.775 / 6.999 |
| baseline | after | 450 | 329.212 / 339.308 / 343.317 | 0 / 0 / 0 | 6.061 / 6.817 / 6.927 |
| bounded5ms | before | 450 | 16.694 / 23.964 / 26.445 | 0 / 0 / 0 | 5.975 / 6.749 / 6.978 |
| bounded5ms | after | 450 | 15.726 / 18.889 / 20.704 | 0 / 0 / 0 | 5.619 / 6.614 / 6.918 |

| Label | Variant | Flood successes/s | Flood p50 / p95 / p99 ms | Flood errors / pool timeouts / 55P03 | Flood observed hold p50 / p95 / p99 ms |
| --- | --- | ---: | ---: | ---: | ---: |
| baseline | before | 6905.700 | 14.280 / 16.002 / 18.045 | 0 / 0 / 0 | 5.974 / 6.779 / 6.979 |
| baseline | after | 156.600 | 415.327 / 1592.131 / 2447.674 | 0 / 0 / 0 | 6.356 / 6.600 / 6.772 |
| bounded5ms | before | 6632.700 | 14.509 / 18.862 / 27.395 | 0 / 0 / 0 | 5.948 / 6.725 / 7.099 |
| bounded5ms | after | 165.400 | 12.172 / 19.098 / 24.448 | 620992 / 0 / 620970 | 5.783 / 5.913 / 6.135 |

## Errors

The `55P03` count includes the preserved SQLSTATE in both
`MessageError::Repository` and `MessageError::Contended`. In the scoped
timeout implementation, only counter-append `55P03` becomes `Contended`.
These direct repository measurements do not exercise HTTP responses;
the 503 and `Retry-After: 1` mapping is described separately in the
[transaction and timeout audit](channel_transaction_audit.md#caller-visible-failures-and-rollback).

| Label | Run | Variant | Lane | All errors | Pool acquire timeout | 55P03 | 57014 | 40P01 | Other |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 1 | before | probe | 0 | 0 | 0 | 0 | 0 | 0 |
| baseline | 1 | before | flood | 0 | 0 | 0 | 0 | 0 | 0 |
| baseline | 1 | after | probe | 0 | 0 | 0 | 0 | 0 | 0 |
| baseline | 1 | after | flood | 0 | 0 | 0 | 0 | 0 | 0 |
| baseline | 2 | before | probe | 0 | 0 | 0 | 0 | 0 | 0 |
| baseline | 2 | before | flood | 0 | 0 | 0 | 0 | 0 | 0 |
| baseline | 2 | after | probe | 0 | 0 | 0 | 0 | 0 | 0 |
| baseline | 2 | after | flood | 0 | 0 | 0 | 0 | 0 | 0 |
| baseline | 3 | before | probe | 0 | 0 | 0 | 0 | 0 | 0 |
| baseline | 3 | before | flood | 0 | 0 | 0 | 0 | 0 | 0 |
| baseline | 3 | after | probe | 0 | 0 | 0 | 0 | 0 | 0 |
| baseline | 3 | after | flood | 0 | 0 | 0 | 0 | 0 | 0 |
| bounded5ms | 1 | before | probe | 0 | 0 | 0 | 0 | 0 | 0 |
| bounded5ms | 1 | before | flood | 0 | 0 | 0 | 0 | 0 | 0 |
| bounded5ms | 1 | after | probe | 0 | 0 | 0 | 0 | 0 | 0 |
| bounded5ms | 1 | after | flood | 193462 | 0 | 193460 | 2 | 0 | 0 |
| bounded5ms | 2 | before | probe | 0 | 0 | 0 | 0 | 0 | 0 |
| bounded5ms | 2 | before | flood | 0 | 0 | 0 | 0 | 0 | 0 |
| bounded5ms | 2 | after | probe | 0 | 0 | 0 | 0 | 0 | 0 |
| bounded5ms | 2 | after | flood | 213407 | 0 | 213399 | 8 | 0 | 0 |
| bounded5ms | 3 | before | probe | 0 | 0 | 0 | 0 | 0 | 0 |
| bounded5ms | 3 | before | flood | 0 | 0 | 0 | 0 | 0 | 0 |
| bounded5ms | 3 | after | probe | 0 | 0 | 0 | 0 | 0 | 0 |
| bounded5ms | 3 | after | flood | 214123 | 0 | 214111 | 12 | 0 | 0 |

The CSV retains pool settings, full wall time and all per-run fields.
Reproduce the benchmark and parsing commands in [README.md](README.md).
