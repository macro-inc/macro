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

## Gotchas

- Append only as the last statement before commit; activity batches lock counters
  in channel order. Helpers never commit the caller's transaction.
- Guard a stalled counter holder with a five-second lock timeout, preserving
  stricter inherited lock timeouts and restoring the exact setting inside the
  final statement. Do not set a statement deadline. Callers acquire process
  admission before taking their transaction's database connection.
- Log rows are immutable. Pruning removes a prefix within each channel and keeps
  its counter, so the first retained sequence minus one is the resume floor.
  Never prune with `SKIP LOCKED`: it can remove newer rows while older ones
  stay, and readers past the hole would miss changes without a reset. One pruner
  runs at a time under `try_lock_prune_in`.
- Database triggers also write here, for removals no service code sees: a
  removed channel deletes its log and counter, and channel-thread calls removed
  with their owner append message changes, counters locked in channel order
  (`20261124030000_channel_change_log_cleanup.sql`).
- Read limits and retention cutoffs come from callers; do not add client policy here.

## Related

- Rules: `.agents/rules/rust/db.md`, `.agents/rules/rust/architecture.md`.
