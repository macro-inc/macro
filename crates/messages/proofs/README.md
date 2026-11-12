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
psql <local-scratch-url> -v stale=false \
  -f crates/messages/proofs/channel_change_append_plans.sql
psql <another-local-scratch-url> -v stale=true \
  -f crates/messages/proofs/channel_change_append_plans.sql
```

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
