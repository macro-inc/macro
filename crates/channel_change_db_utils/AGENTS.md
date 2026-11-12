# channel_change_db_utils

## What it is

Shared table ownership for channel change counters and their append-only log.
These helpers let each domain append a change inside its own write transaction.

## Start here

- `src/append.rs`: singular and ordered activity-batch sequence allocation.
- `src/read.rs`: counter and bounded log snapshots, without client policy.
- `src/prune.rs`: bounded retention deletion that preserves counters.

## Scope

- Owns: SQL for `channel_change_counters` and `channel_change_log`.
- Not here: channel authorization, visible activity selection, message hydration,
  or reset/retention policy → `crates/messages`; activity persistence → `crates/activity`.

## Boundaries

- Depends on: SQLx, chrono, UUID; no domain-crate dependencies.
- Used by: `messages`, `call`, and document-storage activity composition.

## Checks

- `cargo test -p channel_change_db_utils` (`SQLX_OFFLINE` unset).
- Query plan reproduction: `crates/messages/proofs/README.md`.

## Gotchas

- Append only as the last statement before commit; activity batches lock counters
  in channel order. Helpers never commit the caller's transaction.
- Cap the whole append statement at 50 ms without relaxing a stricter inherited
  statement timeout. Set it with one preflight query before counter acquisition;
  PostgreSQL starts a statement's timer before executing its SQL. Restore the
  prior setting inside the append after consuming all log inserts, so no round
  trip follows counter acquisition. Rollback restores settings after failure.
  Leave `lock_timeout` unchanged; the deadline covers the append statement,
  including repeated lock waits, but not earlier writes or the later commit.
- Log rows are immutable. Pruning removes a prefix within each channel and keeps
  its counter, so the first retained sequence minus one is the resume floor.
- Read limits and retention cutoffs come from callers; do not add client policy here.

## Related

- Rules: `.agents/rules/rust/db.md`, `.agents/rules/rust/architecture.md`.
