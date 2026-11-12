# Channel change query proofs

Use a dedicated local Postgres with the MacroDB migrations applied to `template1`.
Do not target an application stack or a hosted database. Both PostgreSQL 14 and
18 are covered by the recorded results.

See [the recorded matrix](channel_change_plan_results.md) for execution times,
buffer counts, fixture sizes, and the rejected unbounded prune plan.

Run the exact read, bulk and channel-write hydration, reply-root lock, and prune
SQL extracted from the current Rust sources. Channel-write hydration covers
both a present message with references and a missing message.

Counter, log, and pruning SQL live in `crates/channel_change_db_utils`; message
hydration and client reset policy remain in `crates/messages`.

Run the harness with your dedicated local database role:

```sh
python3 crates/messages/proofs/channel_change_plans.py \
  --port <dedicated-port> --user <your-local-role>
```

The harness finds `psql` on `PATH`, accepts only loopback hosts, and creates two
new databases with unique names. It refuses to reuse an existing database and
does not drop databases. `--maintenance-db` selects the connection used to
create them; `--suffix` and `--output` make the database names and output location
explicit. Keep the databases until the plans have been reviewed, then remove
them through the normal local database workflow.

Each fixture contains one million log rows (100,000 in the selected channel),
1.99 million messages, one million thread states, one million each of activity,
attachments, reactions and mentions, 100,010 counters, and 100,000 bot records.
The selected 200 roots each have 99 replies; hydration also covers 800 reference
and bot identities. This meets the upper end of the documented thread-table
size tier and assumes large volume for the per-message tables.

The first fixture is analyzed after seeding. The second is analyzed with a tiny
fixture, has autovacuum disabled, and is then grown without refreshing its
statistics. Each query runs twice with a forced custom plan and twice with a
forced generic plan. Writes and row locks run inside transactions that roll
back. The output retains exact SQL, the synthetic seed, row counts, full
`EXPLAIN (ANALYZE, BUFFERS)` JSON, and `summary.json` with timing and buffer counts.
First runs are not claimed to have a cold cache.

The separate append proof covers the shared counter/log statement and ordered
activity batches, with 1.1 million log rows. Call status changes use this same
scalar append after capturing the call's own channel and discussion metadata.
Run each statistics mode on its own new, migrated scratch database; the script
rolls back its fixture and mutations:

```sh
python3 crates/messages/proofs/sync_append_plan_sql.py --check
psql <local-scratch-url> -v stale=false \
  -f crates/messages/proofs/channel_change_append_plans.sql
psql <another-local-scratch-url> -v stale=true \
  -f crates/messages/proofs/channel_change_append_plans.sql
```

The SQL check reads `crates/channel_change_db_utils/src/append.rs` and compares
all three prepared statements byte for byte with their source literals. After an
append change, run the same script without `--check` to refresh them; it performs
no database work. The preflight sets a 50 ms deadline for the next append
statement unless the inherited statement timeout is stricter. The append
restores that setting before it returns and never changes `lock_timeout`.
The proof measures the preflight separately, rolling its setting back after
each sample. Before each scalar/batch sample it sets the effective deadline
to 50 ms and passes `15s` as the prior setting to restore.

The call metadata proof seeds 1.1 million `call_entities` rows (100,000 in the
selected channel and ten times that across other channels). It covers a channel
thread, a legacy call chat, and a missing call, each with custom/generic plans
and two executions. It reads only call-owned metadata; the call repository does
not query message storage to discover a root. A missing root may be logged by
its canonical call ID and returned to a client as a removed ID.

```sh
psql <new-local-call-scratch-url> -v stale=false \
  -f crates/messages/proofs/channel_call_metadata_plans.sql
psql <another-new-local-call-scratch-url> -v stale=true \
  -f crates/messages/proofs/channel_call_metadata_plans.sql
```

The SQL scripts allow 300 seconds for their synthetic seed, then set a 15-second
statement timeout for the measured queries. Call metadata seed inserts disable
unrelated foreign-key triggers only inside the transaction; all changes roll
back. Use a dedicated local role permitted to seed that scratch database.

Do not run these harnesses during latency measurements: they intentionally put
substantial load on the local database server.

## Supplemental historical guard

The historical body UPDATE, including `content <> $5`, is unchanged from
baseline `354da677b5`. Its supplemental proof checks the matching update and
idempotent no-op against the existing disposable fixtures from the main harness:

```sh
psql <existing-local-proof-fixture-url> \
  -f crates/messages/proofs/channel_historical_body_plans.sql
```

Run once against a fresh-statistics fixture and once against a stale-statistics
fixture for each PostgreSQL version. The script requires the untouched synthetic
message, sets its import metadata inside a transaction, and rolls back each
sample to a savepoint before rolling back the entire transaction. It does not
create or reset databases. These measurements are separate from the 288-query
main matrix and the changed-query proof.

## Repository write latency

The existing `channel_write_latency_results.md` and its CSV are historical:
`before` is pinned to `354da677b5`, and `after` is the pre-timeout implementation
at `5743b47a10`. The recorded tables and commit diagnostics do not measure the
later counter deadline. Keep results collected from the current source in
separate artifacts with their source revision; do not relabel the old rows.

The ignored `repository_write_latency` test compares the old and current
repository implementations on the same dedicated local database. Set
`DATABASE_URL` yourself to that database's MacroDB URL; its migrations and
`template1` must already be prepared. Each invocation creates an isolated SQLx
test database. Run from the repository root.

The default test uses an explicit Tokio runtime with sixteen worker threads,
matching the application's multi-thread execution model. The separately named
`repository_current_thread_write_latency` test preserves SQLx's current-thread
test runtime for comparison. Both modes clone their isolated test database's
connection options and create, warm and close the measured pool inside the
selected runtime; they do not reuse a pool created on another runtime.

Compile both profiles before collecting measurements, then wait for other
builds, checks, database jobs and applications using that server to finish:

```sh
export DATABASE_URL='<dedicated-local-macrodb-url>'
nix develop --command bash -c 'unset SQLX_OFFLINE; cargo test -p messages --all-features --no-run'
nix develop --command bash -c 'unset SQLX_OFFLINE; cargo test -p messages --all-features --release --no-run'
```

Run debug and release sequentially, with no other workload on the database:

```sh
nix develop --command bash -c 'unset SQLX_OFFLINE; cargo test -p messages --all-features repository_write_latency -- --ignored --nocapture'
nix develop --command bash -c 'unset SQLX_OFFLINE; cargo test -p messages --all-features --release repository_write_latency -- --ignored --nocapture'
```

To reproduce the current-thread comparison instead, use its distinct name:

```sh
nix develop --command bash -c 'unset SQLX_OFFLINE; cargo test -p messages --all-features repository_current_thread_write_latency -- --ignored --nocapture'
nix develop --command bash -c 'unset SQLX_OFFLINE; cargo test -p messages --all-features --release repository_current_thread_write_latency -- --ignored --nocapture'
```

The current-thread names do not match the default filters above, so one command
does not silently run both runtime modes.

Each profile and runtime runs three repetitions of 2,000 measured writes for
every operation (`create`, `edit`, `react`, `delete`), implementation (`before`,
`after`), and layout: one, four or sixteen writers in one channel, and sixteen writers across
sixteen channels. Each case first performs 128 unmeasured warmup writes. Pool
connection setup, fixtures, worker startup and cleanup are outside the measured
batch. Query logging is disabled for these measurements.

The baseline method bodies come from commit `354da677b5` in
`src/outbound/pg_message_repo/test/baseline.rs`. Its message lookup calls the
pinned `require_message_before_sequences_in` helper and retains the original
hydration SQL, so the optimized channel hydration path is used only by `after`.
The baseline also retains the original transaction boundaries and reference
writes; it does not substitute isolated SQL timings for repository operations.

Output identifies the runtime (`multi_thread_16` or `current_thread`), profile,
repetition, writers, channels, operation and implementation, followed by the
sample count, median, p95, p99, measured batch wall time and throughput in
operations per second. Keep runtime modes separate when comparing results.

## Commit phase diagnostic

Run the separate ignored diagnostic only after the latency runs have finished.
It enables SQLx query tracing and measures the current implementation alone on
the explicit sixteen-worker runtime:

```sh
nix develop --command bash -c 'unset SQLX_OFFLINE; cargo test -p messages --all-features repository_commit_phase_latency -- --ignored --nocapture'
nix develop --command bash -c 'unset SQLX_OFFLINE; cargo test -p messages --all-features --release repository_commit_phase_latency -- --ignored --nocapture'
```

The separately named diagnostic preserves the current-thread comparison:

```sh
nix develop --command bash -c 'unset SQLX_OFFLINE; cargo test -p messages --all-features repository_current_thread_commit_phase_latency -- --ignored --nocapture'
nix develop --command bash -c 'unset SQLX_OFFLINE; cargo test -p messages --all-features --release repository_current_thread_commit_phase_latency -- --ignored --nocapture'
```

Its pool is also created from the scratch database's cloned connection options
inside the selected runtime. Both diagnostics label every row with runtime and
profile. For each profile and runtime, they record 2,000 writes per operation
with one and sixteen writers in one channel, after an unmeasured warmup. Each
reports median, p95 and p99 for three intervals:

- `commit_*`: the SQLx-observed `COMMIT` round trip, including its acknowledgement.
- `post_append_observed_*`: from the append query's client completion event to
  the commit acknowledgement event. This excludes server append time and
  includes intervening client work, tracing overhead and the commit round trip.
- `append_to_commit_upper_*`: an upper-bound estimate from the append query's
  start through commit acknowledgement, reconstructed from SQLx elapsed time
  and completion timestamps. It includes waiting to acquire the channel
  counter, append execution, intervening client work and the commit round trip.

Neither append interval is the exact duration of the server's counter lock.
The post-append interval omits the time already spent holding the lock inside
append execution; the queue-inclusive estimate includes time before the lock
was acquired. Keep these instrumented diagnostics separate from the
uninstrumented repository latency comparison.

## Historical fixed-arrival mixed writes

The 108 existing fixed-arrival and delayed-commit rows are a pre-timeout
snapshot: old methods at `354da677b5` versus `5743b47a10`. Reproducing those
historical results requires a separate checkout of that original source and
benchmark harness. The commands in this section and the next describe that
snapshot; they do not establish behavior of the current deadline implementation.
For current below-ceiling and saturation evidence, use the result-recording
bounded-write and shared-pool tests documented below.

The ignored `repository_open_loop_write_latency` test runs on the explicit
sixteen-worker runtime with sixteen database connections. Run it in release
mode after compilation and other database work have stopped:

```sh
nix develop --command bash -c 'unset SQLX_OFFLINE; cargo test -p messages --all-features --release repository_open_loop_write_latency -- --ignored --nocapture'
```

Each of three repetitions compares `before` and `after` at total offered rates
of 50, 200, 1,000 and 3,000 writes per second, first in one channel and then
across sixteen channels. Every case contains 2,000 measured writes with an even
mix of create, edit, react and delete. Operations rotate through channels
independently, so a channel is not assigned only one operation. Each case uses
fresh targets and an unmeasured warmup on the same isolated test database.

The arrival timer runs independently of completions and the sixteen-worker
limit. It retains every original arrival time, emits late arrivals without
skipping them, and lets them queue for a worker. `arrival_*` measures from that
scheduled arrival through completion, including scheduler lateness and queue
wait, to avoid coordinated omission. `service_*` starts after worker admission.
`achieved_ops_s` includes draining all scheduled writes; it is distinct from the
offered arrival rate. No requests or latency samples are discarded.

## Historical synthetic pre-commit delay

The original `repository_commit_delay_write_latency` runner unwraps every
repository result. Under a counter deadline, saturated synthetic cases can
correctly return contention errors and stop that runner. Run this legacy
comparison only from the pre-timeout source/harness snapshot (`5743b47a10`) in
a separate checkout. The current result-recording runners retain failures and
latency samples; their evidence is separate from the historical 108 rows.

The ignored `repository_commit_delay_write_latency` test holds each transaction
for a requested two or five milliseconds after its last SQL statement and
before `COMMIT`, equally for `before` and `after`:

```sh
nix develop --command bash -c 'unset SQLX_OFFLINE; cargo test -p messages --all-features --release repository_commit_delay_write_latency -- --ignored --nocapture'
```

This uses benchmark-only copies of the pinned old and current write methods
in `src/outbound/pg_message_repo/test/benchmark/delayed.rs`. Their SQL and
hydration paths are unchanged. Only these copies insert the async timer;
production methods and the ordinary benchmark baseline have no delay hook.
Verify the copies before running the synthetic cases:

```sh
python3 crates/messages/proofs/check_delayed_writers.py
```

This audit compares method arguments, return types and complete Rust body tokens,
ignoring comments and whitespace while preserving string literals byte for byte.
It permits only the measured timer immediately before `COMMIT` and the extra
returned duration. It also verifies the old baseline against `354da677b5`, with
its required empty sequence metadata and pinned hydration lookup.

For `after`, this artificial interval holds the channel counter lock. It is a
controlled stress case, not a measurement of the database's actual commit time.

Each of three repetitions uses sixteen workers and connections in one channel,
with 2,000 measured mixed writes per case. Closed-loop cases report the write
rate and latency ceiling. Open-loop cases offer 20, 50, 100 and 200 total writes
per second and retain the same scheduled-arrival latency accounting described
above. Each case has an unmeasured warmup and fresh message targets.

The output includes `requested_hold_ms` and the actual timer interval's p50,
p95 and p99. Timer resolution and scheduling can make the observed hold longer
than requested; use the reported actual interval when interpreting the result.
Query tracing is disabled. These synthetic results remain separate from both
the ordinary latency comparison and the traced commit-phase diagnostic.

## Shared-pool channel isolation

The ignored `repository_shared_pool_isolation` test measures whether one busy
channel delays writes to another through their shared connection pool:

```sh
nix develop --command bash -c 'unset SQLX_OFFLINE; CHANNEL_SEQUENCE_POOL_LABEL=deadline50ms cargo test -p messages --all-features --release repository_shared_pool_isolation -- --ignored --nocapture'
```

It uses the same caller-provided dedicated `DATABASE_URL` and the sixteen-worker
runtime. One shared pool has the document storage service's settings: minimum
10 connections, maximum 50, and SQLx's default acquire timeout. The CSV records
these actual settings and the initial pool size; all 50 connections are opened
before measurement. Setup and cleanup are outside the measured interval.

Each of three repetitions runs the pinned `before` and current `after` methods
for 30 seconds each. One hundred closed-loop writers each edit their own root
message in the flood channel. Independently, five scheduled writes per second
each edit a distinct root in a second channel: 150 probe samples per case.
Distinct rows avoid message-row contention between writers; only `after`
contends for a shared channel counter. Both implementations use the exact
benchmark-only methods audited above, with a requested five-millisecond timer
between the final SQL statement and `COMMIT`.

There is no shared semaphore ahead of the pool. Probe arrivals retain their
original schedule, including when earlier writes have not finished. Probe
latency includes scheduler lateness, pool acquisition and repository execution;
flood latency starts immediately before each repository call. Writers stop
starting flood operations at the measurement deadline, then all in-flight
operations drain. Throughput uses the full wall time including that drain.

Each lane reports attempts, successes, errors, attempt and successful-write
latency p50/p95/p99, successful throughput, and actual successful pre-commit
hold p50/p95/p99 alongside `requested_hold_ms`. Error counts distinguish pool
acquisition timeouts, PostgreSQL `55P03`, `57014`, `40P01`, and other errors.
Failed writes remain in attempt-latency samples and are not unwrapped or
silently dropped. An empty successful sample set is reported as `NA`.

Use `CHANNEL_SEQUENCE_POOL_SECONDS` to change the positive integer duration
(default 30); each second adds five scheduled probes. Use an ASCII alphanumeric,
underscore or hyphen `CHANNEL_SEQUENCE_POOL_LABEL` to distinguish runs after a
code change. Keep all three repetitions and the default duration for reported
comparisons. The artificial timer models extra time held before commit; it
is not a measurement of actual database commit latency.

After all three repetitions finish, validate and summarize one or more labeled
release logs with:

```sh
python3 crates/messages/proofs/summarize_pool_isolation.py /tmp/pool-baseline.log
```

The script checks pool settings, case completeness, all error counts, and 150
probe attempts per default case. It writes the full per-run CSV and a Markdown
report with per-run tables and medians of the three per-run percentiles and
rates; it does not pool percentile samples across runs. Error totals remain
sums. Pass multiple log paths to compare distinct labels. The generated report
records the pinned old source and the known `baseline`, `bounded5ms`,
`bounded50ms` and `deadline50ms` source states, their measurement environment, and the repository
error classification. Current logs append failed-attempt p50/p95/p99 as columns
35–37; the parser also reads legacy 34-column logs and marks their unavailable
failed latencies `NA`. Failure fractions use errors divided by all attempts,
including for the legacy logs.
For a diagnostic duration other than 30 seconds, pass `--expected-seconds` with
the same value used by the benchmark.

## Current writes below the synthetic ceiling

The ignored `repository_bounded_write_latency` test checks current repository
writes with the total counter-allocation statement deadline enabled:

```sh
nix develop --command bash -c 'unset SQLX_OFFLINE; CHANNEL_SEQUENCE_BOUNDED_LABEL=deadline50ms cargo test -p messages --all-features --release repository_bounded_write_latency -- --ignored --nocapture'
```

It uses sixteen workers and connections in one channel. Each of three
repetitions measures 2,000 mixed writes per case: sixteen closed-loop writers
without a synthetic hold; fixed arrivals at 1,000 and 3,000 writes/s without a
hold; 20, 50 and 100 writes/s with a requested 5 ms pre-commit hold; and 200
writes/s with a requested 2 ms hold. No-hold cases call the current repository
methods directly. Delayed cases use the same audited current-method copies
as the earlier synthetic proof. All cases preserve the current total statement
deadline: one preflight round trip sets a 50 ms timeout, or a stricter inherited
timeout, before counter allocation; the append restores the old setting in the
same statement. This is distinct from the discarded per-lock 50 ms timeout.

All sixteen pool connections are opened before timing. Each case then primes
its four write paths with 128 sequential warmup writes, reported separately.
Using one warmup writer avoids introducing a saturated synthetic-delay workload
before a below-ceiling case. The measured fixed-arrival cases retain every
original arrival and queue for the same sixteen-worker semaphore as the earlier
open-loop proof; the semaphore never blocks the arrival scheduler. Fixtures,
warmup and cleanup are outside the measured batch.

The CSV includes every attempt, success and error; SQLSTATE and pool-acquisition
error counts; all-attempt, successful and failed arrival latency; service time;
observed hold duration; and successful/attempted throughput including drain.
Writes are not retried. The test prints all cases and then fails if any measured
or warmup request failed. Summarize the completed release log with:

```sh
python3 crates/messages/proofs/summarize_bounded_latency.py /tmp/deadline50ms-bounded.log
```

The parser validates all 42 rows (seven cases, three repetitions, warmup and
measurement), writes raw CSV and per-run/median Markdown tables, and exits with
failure after writing the report if any request failed.


## Retained per-lock timeout counterexample

The `bounded50ms` shared-pool experiment was stopped after three old-method
cases and two new-method cases. Its per-lock 50 ms cap did not bound the total
append statement: successive transaction-id lock waits could each finish below
the cap while the whole statement kept a connection occupied. This incomplete
experiment is [retained separately](channel_pool_isolation_bounded50ms_partial_results.md);
it is not a completed three-run comparison.
The `deadline50ms` phase replaces that per-lock cap with a total statement
budget and must supply its own complete results.

Extract the ten completed rows without inventing the missing third new case:

```sh
python3 crates/messages/proofs/summarize_pool_isolation.py \
  /tmp/channel-seq-pool-50ms.log --partial-counterexample
```

This validates the exact three-old/two-new case set and writes
`channel_pool_isolation_bounded50ms_partial_runs.csv` and its separate Markdown
report. It deliberately emits no three-run aggregate. The normal parser mode
continues to require all twelve rows per label.

## Final deadline repository matrix

Run the normal release matrix on the current deadline implementation after
its source is fixed, compilation is complete, and other work on the dedicated
database is idle:

```sh
nix develop --command bash -c 'unset SQLX_OFFLINE; cargo test -p messages --all-features --release repository_write_latency -- --ignored --nocapture' > /tmp/deadline-repository-writes.log 2>&1
python3 crates/messages/proofs/summarize_deadline_write_latency.py \
  /tmp/deadline-repository-writes.log --source-revision '<exact tested deadline head>'
```

Pass the exact tested source revision. If it includes uncommitted deadline
changes, qualify the revision explicitly rather than claiming a clean commit.
The parser requires all 96 rows: three repetitions of 2,000 writes for each
operation, variant and writer/channel layout. It validates finite ordered
percentiles and throughput against measured wall time, then writes
`channel_deadline_write_latency_runs.csv` and
`channel_deadline_write_latency_results.md`. These preserve the historical
pre-timeout artifacts. The report shows old/current latency and throughput,
individual-run p95 values, and single-writer absolute and percentage changes.
The current implementation includes one deadline-configuration round trip
before counter acquisition; this is part of the measured repository write.

## Final deadline fixed-arrival comparison

On the same fixed deadline source used for the final repository matrix, rerun
the no-hold old/current fixed-arrival comparison separately:

```sh
nix develop --command bash -c 'unset SQLX_OFFLINE; cargo test -p messages --all-features --release repository_open_loop_write_latency -- --ignored --nocapture' > /tmp/deadline-arrival-writes.log 2>&1
python3 crates/messages/proofs/summarize_deadline_arrival_latency.py \
  /tmp/deadline-arrival-writes.log --source-revision '<exact tested deadline head>'
```

Keep the database free of other work and supply the exact tested revision,
including any working-tree qualification. The parser requires all 48 rows:
three runs, one/sixteen channels, 50/200/1,000/3,000 total arrivals per second,
and old/current variants. Each row must contain 2,000 writes and no artificial
hold. It validates finite ordered latency percentiles and achieved rate against
wall time. It writes `channel_deadline_arrival_latency_runs.csv` and
`channel_deadline_arrival_latency_results.md`, retaining every run plus medians
of each run's p50/p95/p99 and achieved rates. Historical arrival/commit-delay
files are unchanged. The old saturation-with-delay runner remains historical;
use the result-recording shared-pool runner for current saturation evidence.


The recorded complete shared-pool comparison combines the pre-timeout,
5 ms per-lock, and final total-deadline phases; the discarded incomplete
50 ms per-lock experiment stays in its separate artifact:

```sh
python3 crates/messages/proofs/summarize_pool_isolation.py \
  /tmp/channel-seq-pool-baseline.log \
  /tmp/channel-seq-pool-bounded.log \
  /tmp/channel-seq-pool-deadline.log
```

The [combined report](channel_pool_isolation_results.md) records the final
source revision and the dedicated server-log cross-check for those three
final deadline runs. Its failed-request latency includes pool acquisition
before the statement deadline begins.
