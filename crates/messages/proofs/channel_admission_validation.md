# Channel sequence and write admission validation

The measured repository, admission gate, SQL and benchmark source is
`a40fc0e55d5fe953728b04c93d2273b24e71d977`. The subsequent document HTTP change
reuses the shared public contention message; its corresponding test updates
and these reports do not change a measured write path. The old repository
comparison is pinned to `354da677b583944daaa99e84f231fc0909cea990`.

All database writes used dedicated loopback test databases. The application
stack was not started, stopped, rebuilt or reseeded. No hosted database was used.

## Package checks

Package test commands ran with `SQLX_OFFLINE` unset. Builds used the Nix
development environment with `RUSTC_WRAPPER` and `RUSTC_WORKSPACE_WRAPPER` empty.
Package tests used
`cargo test -p <package>` according to their directory guides, with
`--all-features` for messages, activity, channels, documents and agent session.
The harness used its required process-isolated command below.

| Package | Passed tests | Coverage |
| --- | ---: | --- |
| `messages` | 204 | Library and doc targets; nine manual proof tests ignored by the ordinary run. |
| `message_write_gate` | 11 | Admission, cancellation, nested scope and registry cleanup. |
| `channel_change_db_utils` | 7 | Atomic append, retention, ordering and timeout restoration. |
| `activity` | 76 | Library and doc targets. |
| `bots` | 115 | Library and doc targets, including safe retryable HTTP errors. |
| `channels` | 388 | Library and doc targets. |
| `documents` | 543 | Library, binary and doc targets, including shared contention text. |
| `macro_db_client` | 209 | Library and integration targets. |
| `calendar_service` | 4 | Library, binary and doc targets. |
| `call` | 393 | Library tests and separate doc check passed. |
| `document_storage_service` | 98 | Library tests and separate doc check passed. |
| `slack_import_worker` | 21 | Nineteen library and two binary tests; four existing archive tests ignored. Separate doc check passed. |
| `slack_integration` | 181 | 173 library and eight schema tests. Separate doc check passed. |
| `agent_harness` | 565 | Required `cargo nextest run -p agent_harness --lib --test-threads=2 --no-fail-fast`; no package features exist. |
| `agent_session` | 567 | Library, both binary targets and doc targets. |
| **Total** | **3382** | Repeated runs and manual performance tests are not double-counted. |

Important regression tests include:

- `concurrent_writers_publish_gap_free_committed_prefix`: unique, gap-free
  committed sequences with concurrent create/edit/react writers and a reader
  that observes every change below a visible counter.
- `document_writes_execute_exactly_the_previous_statements`: document writes
  still execute create 11, edit 9, react 8, patch thread 3, delete 8 and delete
  thread 4 statements.
- `twenty_simultaneous_channel_posts_succeed_with_commit_holds`: every post in
  the burst succeeds, including with a five-millisecond commit hold.
- `parent_admission_rejects_without_a_connection_and_client_id_retry_is_unique`:
  rejection occurs before pool acquisition and a stable client ID creates no
  duplicate on retry.
- `retry_after_admission_rejection_without_client_id_creates_one_message`:
  retrying a known pre-write rejection creates one message without a nonce.
- `channel_counter_guard_rolls_back_the_entire_message` and
  `channel_stalled_holder_guard_applies_with_database_timeouts_disabled`:
  stalled counter holders return the typed retryable failure and do not leave
  partial message or sequence changes.

Gate tests also cover cancellation before admission, cancellation after a slot
is assigned, scoped nested writes, and removal of 1,024 idle parent entries.
Import tests cover the persistent cursor progressing beyond more than 50
ineligible jobs and a held first job fence. Agent tests retain queued replies
and their durable identities when admission is busy.

## Database and mechanical checks

All checks below passed locally. The Rust validation sequence ran in order.

| Result | Check | Source / evidence |
| --- | --- | --- |
| Pass | `just rust-check` | Workspace type check and the separate sync-service check. |
| Pass | `just clippy` | Workspace with all features, sync service, and both required Soup feature configurations; warnings denied. |
| Pass | `just format`, then `just hakari` | Formatting and generated dependency metadata; reviewed the one formatting-only line change. |
| Pass | `cargo fmt --all -- --check` | Formatting check after generation. |
| Pass | `cargo x deps --check` | Generated dependency closures current. |
| Pass | `just check` | Format, dependency, code-rule and privacy checks; existing warnings concern unchanged files. |
| Pass | `just pr-privacy` | Branch commit-message privacy check. |
| Pass | Call and document package `check` recipes | Both use `cargo check --all-features`. |
| Pass | `check_delayed_writers.py` | Pinned old methods and current delayed copies match source tokens except the injected timing interval and its returned duration. |
| Pass | `sync_append_plan_sql.py --check` | Both measured append statements match their source SQL byte for byte. |
| Pass | `git diff --check` | No whitespace errors. |

The standard workspace Rust check recipes use their configured offline SQLx
mode; the package tests above ran with `SQLX_OFFLINE` unset.

SQLx preparation passed with
`just --set DATABASE_URL=<dedicated-local-macrodb-url> prepare_db`; the generated
`.sqlx` output is committed. The source-equivalence scripts compare the baseline
SQL and counter append literals against the exact benchmark and plan inputs.

The production-size database proofs include 288 read, hydration and prune
measurements, 32 current five-second-guard append measurements, and 208 bounded
admission-discovery measurements across PostgreSQL 14 and 18, fresh and stale
statistics, and custom and generic plans. Log fixtures contain at least one
million rows. See the [query report](channel_change_plan_results.md),
[discovery report](channel_admission_discovery_plan_results.md) and
[reproduction commands](README.md).

## Performance evidence and limits

The three-run release reports retain all per-run samples and tails:

- [Repository write latency](channel_admission_write_latency_results.md):
  192,000 successful measured writes, at least 2,000 per operation, variant,
  writer/channel layout and run.
- [Fixed-arrival latency](channel_admission_arrival_latency_results.md): 96,000
  successful writes at 50, 200, 1,000 and 3,000 offered writes/s.
- [Pool isolation](channel_admission_pool_results.md): a 50-connection pool,
  one channel flooded at 1,000 or 3,000/s, a neighbor at 20/s, and no hold or a
  requested two/five-millisecond pre-commit hold. All 7,200 neighbor requests
  succeeded with no database errors or pool acquisition timeouts. The current
  flooded channel committed 146,788 writes and rejected 213,212 admissions.

These results do not establish an absence of latency regressions. Saturating
one channel with 16 closed-loop writers raises p95 by 66.7–130.3% and lowers
throughput by 46.4–57.6%, depending on operation. The single-writer edit p95
increased by 0.056 ms. Two no-hold pool runs had neighbor p99 of 67.480 ms and
35.831 ms; the latter also had flood p99 of 1,727.476 ms. The fixed-arrival
16-channel, 50/s case has one p99 outlier of 19.575 ms. These remain in the
reports: the admission cap bounds interference, not every observed latency.

## Coverage and remaining scope

Channel activities have an **at-least-once** log guarantee. DSS atomically
inserts each selected activity with its channel log entry, returns the allocated
sequence in memory, then publishes and acknowledges. Replay may allocate a
second sequence for the same deterministic activity ID. The activity crate
does not depend on channels and no activity lookup index was added.

The [transaction audit](channel_transaction_audit.md) lists admission,
counter-to-commit statements, timeouts, cancellation, caller-visible errors and
retry boundaries. The [writer audit](channel_writer_rates.md) identifies actual
source-level throttles and bursts. Remaining scope is explicit:

- The user-deletion `cleanup_user_call_entities` trigger is unchanged. A
  retained cached channel call root can show its old call status until fetched
  again or the channel resets.
- Historical import checkpoint/search completion and savepoint release still
  run under the counter lock, as listed in the transaction audit.
- The cap bounds live admitted Rust futures per process. Cancellation can
  release a permit before PostgreSQL finishes its outstanding query or rollback.
  The five-second guard bounds each counter lock wait, not total cancellation
  cleanup; earlier locks and COMMIT retain existing settings.
- A known admission 503 precedes writes. A webhook retry after an unknown commit
  outcome still has no idempotency key and can duplicate a message, as before.
- Live connected Tempo traces and application-stack health/browser proofs were
  not run. The backend unit, integration, SQL and load proofs above do not
  replace those stack-level checks.
