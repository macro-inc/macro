# message_write_gate

## What it is

Process-wide admission for writes to one typed message parent. Four writes may
proceed concurrently; further writers wait up to two seconds before receiving
a typed retryable admission error.

## Start here

- `src/lib.rs`: shared registry, cancellation-safe lease accounting and permit.
- `src/test.rs`: limit, key isolation, cancellation, timeout and cleanup proofs.

## Scope

- Owns: admission before connection acquisition and idle registry cleanup.
- Not here: transactions, sequence allocation, HTTP responses or retry policy.

## Boundaries

- Depends on: Tokio synchronization/time and tracing only.
- Used by: message persistence and transaction owners that write message parents.
- Admission is shared within one process, never across separate processes.
- `WritePermit::scope` carries admission across caller-owned journal leases;
  nested same-parent writes serialize on one local slot without reacquiring
  global admission. Spawned tasks do not inherit this scope.

## Checks

- `cargo test -p message_write_gate` (no database required).
- `just check` after changes.

## Gotchas

- Retain every permit through commit or rollback; acquiring a connection does
  not finish the protected write.
- Update lease counts and remove idle entries under the registry mutex; do not
  infer idleness from `Arc::strong_count`.
- Return the semaphore slot before dropping its lease; reversing the field
  order could remove an entry while its last slot is still held.
- Parent identifiers must be opaque because admission spans record them.
