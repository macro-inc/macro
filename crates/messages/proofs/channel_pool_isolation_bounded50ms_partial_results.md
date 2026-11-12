# Shared-pool channel isolation results

**Incomplete counterexample, not the required three-run proof.**
This per-lock timeout experiment was stopped after three old-method
cases and two new-method cases. The rows below are only the completed
cases. There is no third new-method result or three-run aggregate.

The completed new-method probe runs had p95 **401.020 / 369.860 ms** and
**0 errors** across 300 probes.
The absence of errors did not establish latency isolation: a per-lock
timeout can restart across successive transaction-id lock waits.
This counterexample motivated the total statement deadline.

## Source and environment

The `before` variant always uses the old repository methods pinned to
`354da677b5`, including their original hydration path. The `after`
variant uses the source state identified by its label:

| Label | Current-method source |
| --- | --- |
| bounded50ms | Discarded per-lock 50 ms timeout; consecutive transaction-id lock waits can exceed 50 ms in total. This did not isolate the shared pool. |

The benchmark-only method copies preserve the ordered SQL and add only
the measured sleep and returned duration; verify them with
[the source-equivalence audit](check_delayed_writers.py). Requests call
the repository directly and have no automatic retries. Each error is
one failed request, not a successfully retried operation.

Pool sizing copies the production branch in
[the document storage server](../../../services/document_storage_service/src/server.rs#L245):
minimum 10, maximum 50, with SQLx's default 30-second acquire timeout.
The recorded benchmark settings are checked against those values.

Recorded environment for the `baseline`, `bounded5ms`, `bounded50ms` and `deadline50ms` measurements:
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
| bounded50ms | 1 | before | probe | 150 / 150 | 18.375 / 25.186 / 28.950 | 18.375 / 25.186 / 28.950 | 5.0 | 5.852 / 6.722 / 6.872 |
| bounded50ms | 1 | before | flood | 181240 / 181240 | 16.062 / 20.911 / 25.731 | 16.062 / 20.911 / 25.731 | 6034.0 | 5.824 / 6.613 / 6.990 |
| bounded50ms | 1 | after | probe | 150 / 150 | 360.996 / 401.020 / 415.625 | 360.996 / 401.020 / 415.625 | 4.9 | 5.871 / 6.560 / 7.484 |
| bounded50ms | 1 | after | flood | 4363 / 4363 | 554.754 / 1553.232 / 2291.340 | 554.754 / 1553.232 / 2291.340 | 142.3 | 6.028 / 6.913 / 7.931 |
| bounded50ms | 2 | before | probe | 150 / 150 | 17.604 / 27.584 / 35.498 | 17.604 / 27.584 / 35.498 | 5.0 | 5.724 / 6.578 / 6.730 |
| bounded50ms | 2 | before | flood | 168039 / 168039 | 17.023 / 24.329 / 31.297 | 17.023 / 24.329 / 31.297 | 5598.7 | 5.764 / 6.576 / 7.412 |
| bounded50ms | 2 | after | probe | 150 / 150 | 342.625 / 369.860 / 374.573 | 342.625 / 369.860 / 374.573 | 4.9 | 5.844 / 6.712 / 7.449 |
| bounded50ms | 2 | after | flood | 4605 / 4605 | 458.047 / 1572.468 / 2460.634 | 458.047 / 1572.468 / 2460.634 | 150.2 | 5.957 / 6.788 / 7.215 |
| bounded50ms | 3 | before | probe | 150 / 150 | 18.145 / 24.726 / 26.340 | 18.145 / 24.726 / 26.340 | 5.0 | 5.802 / 6.691 / 6.855 |
| bounded50ms | 3 | before | flood | 185248 / 185248 | 15.949 / 19.630 / 22.503 | 15.949 / 19.630 / 22.503 | 6171.1 | 5.838 / 6.608 / 6.918 |

## Errors

The `55P03` count includes the preserved SQLSTATE in both
`MessageError::Repository` and `MessageError::Contended`. The classifier
likewise counts underlying `57014` statement cancellations separately;
the domain variant does not hide the original PostgreSQL error code.
Failed-attempt latency is retained separately from successful writes.
Legacy 34-column logs have no failed-latency samples and show `NA` for
that field, even if they contain failures. Current logs have 37 columns.
A failure percentage is calculated from errors divided by all attempts;
it does not discard failed requests from the denominator.
These direct repository measurements do not exercise HTTP responses;
the 503 and `Retry-After: 1` mapping is described separately in the
[transaction and timeout audit](channel_transaction_audit.md#caller-visible-failures-and-rollback).

| Label | Run | Variant | Lane | All errors | Failed % | Failed p50 / p95 / p99 ms | Pool acquire timeout | 55P03 | 57014 | 40P01 | Other |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| bounded50ms | 1 | before | probe | 0 | 0.00% | NA / NA / NA | 0 | 0 | 0 | 0 | 0 |
| bounded50ms | 1 | before | flood | 0 | 0.00% | NA / NA / NA | 0 | 0 | 0 | 0 | 0 |
| bounded50ms | 1 | after | probe | 0 | 0.00% | NA / NA / NA | 0 | 0 | 0 | 0 | 0 |
| bounded50ms | 1 | after | flood | 0 | 0.00% | NA / NA / NA | 0 | 0 | 0 | 0 | 0 |
| bounded50ms | 2 | before | probe | 0 | 0.00% | NA / NA / NA | 0 | 0 | 0 | 0 | 0 |
| bounded50ms | 2 | before | flood | 0 | 0.00% | NA / NA / NA | 0 | 0 | 0 | 0 | 0 |
| bounded50ms | 2 | after | probe | 0 | 0.00% | NA / NA / NA | 0 | 0 | 0 | 0 | 0 |
| bounded50ms | 2 | after | flood | 0 | 0.00% | NA / NA / NA | 0 | 0 | 0 | 0 | 0 |
| bounded50ms | 3 | before | probe | 0 | 0.00% | NA / NA / NA | 0 | 0 | 0 | 0 | 0 |
| bounded50ms | 3 | before | flood | 0 | 0.00% | NA / NA / NA | 0 | 0 | 0 | 0 | 0 |

The CSV retains pool settings, full wall time and all per-run fields.
Reproduce the benchmark and parsing commands in [README.md](README.md).
