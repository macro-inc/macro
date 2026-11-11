# ideas_db_utils

## What it is

Transactional helpers for the `suggestion` tables, for writes that commit
with another crate's: routine suggestions (`crates/scheduled_action`) keep,
dismiss, retire and save a drafted suggestion together with its `routine`
suggestion;
the `ideas` crate's repository shares the lock, limit and change-log helpers.

## Scope

- Owns: the shared SQL for `suggestion`, `suggestion_routine`,
  `suggestion_target` and their `suggestion_change` rows written inside other crates' transactions.
- Not here: rules for what may be written → `crates/ideas` (limits are passed
  in from `ideas::domain::service`).

## Checks

- `cargo test -p ideas_db_utils` (live DB, `SQLX_OFFLINE` unset).

## Gotchas

- `add_routine_idea` takes the person's advisory lock; call it before any
  other idea write in the same transaction, or limits can race.
