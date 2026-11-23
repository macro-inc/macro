# suggestions_db_utils

## What it is

Transactional helpers for the `suggestion` tables, for writes that commit
with another crate's: routine suggestions (`crates/scheduled_action`) keep,
dismiss, retire and save a drafted suggestion together with its `routine`
suggestion;
the `suggestions` crate's repository shares the lock, limit and change-log helpers.

## Scope

- Owns: the shared SQL for `suggestion`, `suggestion_routine`,
  `suggestion_target` and their `suggestion_change` rows written inside other crates' transactions.
- Not here: rules for what may be written → `crates/suggestions` (limits are passed
  in from `suggestions::domain::service`).

## Checks

- `cargo test -p suggestions_db_utils` (live DB, `SQLX_OFFLINE` unset).

## Gotchas

- `add_routine_card` takes the person's advisory lock; call it before any
  other suggestion write in the same transaction, or limits can race.
- `move_routine_card` moves a card only from the state its routine
  suggestion's transition expects; only `crates/scheduled_action`'s
  `pg_suggestion_repo::transition` calls it, after locking the routine
  suggestion's row, and never takes the advisory lock.
