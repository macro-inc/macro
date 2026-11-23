# time_tracking

## What it is

Part of Tasks: the time people log on a task, typed or with a running timer,
and each task's Time logged total. Served over REST by
`document_storage_service` at `/time`.

## Start here

- `src/domain/models.rs`: the entry and timer rules, each one constant or one
  function (`MAX_ENTRY_MINUTES`, `TIMER_LIMIT`, `may_change_entry`,
  `finish_timer`), so a product decision changes one line.
- `src/domain/service.rs`: permissions, the rollout gate, replays, and how a
  start stops and saves the running timer.
- `src/outbound/pg_time_repo.rs`: `time_entry`, `time_timer`, and the total.
- `src/inbound/axum_router.rs`: the REST routes and the typed error body.
- `src/inbound/toolset/`: `LogTime` and `ReadTimeEntries` for chat, channel
  bots and MCP (feature `toolset`); code mode uses the SDK's `task.logTime`
  and `task.timeEntries` and hides them.

## Scope

- Owns: `time_entry`, `time_timer`, the `macro.time_entries` events, and the
  only writes of the Time logged system property (`0x16`).
- Not here: the property's storage → `crates/system_properties`
  (`time_logged`); the guard refusing other writes of it → `crates/properties`.

## Boundaries

- Depends on: `entity_access` (receipts), `system_properties` (feature
  `outbound`), `feature_flags`, `macro_event_broker`, `macro_event_topics`,
  `ai_toolset` (feature `toolset`).
- Used by: `services/document_storage_service`, `ai_tools`.

## Checks

- `cargo test -p time_tracking --all-features` (`SQLX_OFFLINE` unset).

## Gotchas

- Every entry write takes `pg_advisory_xact_lock` on
  `'time_entry:' || task_id`, then rewrites the total from the task's sum in
  the same transaction. Removing the lock fails
  `concurrent_writers_on_one_task_store_the_full_total`.
- A stopped timer's entry keeps the timer's id; that is what makes a stop sent
  twice, or by two devices, save one entry. Start and stop delete the exact
  timer row the domain read, so no timer advisory lock is needed.
- The day of an entry is chosen by the client (a timer's: its start in the
  stopping device's zone, UTC when none). Never derive it on read.
- Writes need `enable-time-tracking` for the caller (`outbound/rollout.rs`);
  a failed flag load is off. `document_storage_service` and `ai_tools` pick
  `LocalTimeTracking` (always on) for the local environment only, and
  `ai_tools` picks `TimeTrackingOff` on a host without a flag client.
- The tools mint the requesting user's receipt, never a bot's: the domain
  takes the author from an authenticated-user receipt, so an agent's entry
  is the person it acts for.
- Events carry the task's new total and never the note. Nothing consumes the
  topic yet.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`,
  `.agents/rules/observability.md` · Skill: `cloud-storage-hexagonal-architecture`
