# time_tracking

## What it is

Part of Tasks: the time people log on a task, typed or with a running timer,
and each task's Time logged total. Served over REST by
`document_storage_service` at `/time`, and over GraphQL for the web app
through `crates/graphql_time_tracking`.

## Start here

- `src/domain/models.rs`: the entry and timer rules, each one constant or one
  function (`MAX_ENTRY_MINUTES`, `TIMER_LIMIT`, `may_change_entry`,
  `finish_timer`), so a product decision changes one line.
- `src/domain/service.rs`: permissions, the rollout gate, replays, and how a
  start stops and saves the running timer.
- `src/outbound/pg_time_repo.rs`: `time_entry`, `time_timer`, and the total.
- `src/inbound/axum_router.rs`: the REST routes and the typed error body.
- `src/domain/report.rs` + `report_service.rs`: reports over a period (a
  project's tasks, the caller's time, the caller's team), their caps
  (`MAX_PERIOD_DAYS`, `MAX_SCOPE_TASKS`, `MAX_EXPORT_ROWS`,
  `MAX_EXPORT_BYTES`) and the CSV export; `src/outbound/pg_report_repo.rs`
  and its `.sql` files hold the sums; `src/inbound/report_router.rs` serves
  `GET /time/summary` and `GET /time/export`, merged into the `/time` router.
- `src/inbound/toolset/`: `LogTime` and `ReadTimeEntries` for chat, channel
  bots and MCP (feature `toolset`); code mode uses the SDK's `task.logTime`
  and `task.timeEntries` and hides them.

## Scope

- Owns: `time_entry`, `time_timer`, the reports over them, the
  `macro.time_entries` events, the
  `time_logged` activity mapping (`domain/activity.rs`), the
  `time_tracking_changed` gateway hint, and the only writes of the Time logged
  system property (`0x16`).
- Not here: the property's storage → `crates/system_properties`
  (`time_logged`); the guard refusing other writes of it → `crates/properties`.

## Boundaries

- Depends on: `entity_access` (receipts), `activity` (models only),
  `system_properties` (the total, and a project's tasks for reports),
  `feature_flags` and `connection_gateway_client` (feature `outbound`),
  `ai_toolset` (feature `toolset`), `macro_event_broker`, `macro_event_topics`.
- Used by: `services/document_storage_service` (the router, and the activity
  consumer's `TimeEntryMacroEvent` arm), `crates/soup_realtime` (the events,
  mapped to a patch on the task), `crates/graphql_time_tracking`, `ai_tools`
  (the tools).

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
- Events carry the task's new total and never the note. Two grouped consumers
  read the topic, both at `InitialOffset::Latest`: `soup_realtime` refreshes
  the task's row on every event, and DSS's activity consumer records one
  `time_logged` activity per `time_entry.logged` (edits and deletes record
  none). Both deploy pipelines apply the `kafka-cluster` stack, which creates
  the topic. A consumer that starts before the topic exists logs one receive
  error for it and keeps reading its other topics; it takes the topic at its
  next metadata refresh (5 minutes at most), starting at the latest offset,
  so events published before then get no live patch or activity row.
- Every committed write also sends `time_tracking_changed`
  (`{ timer, taskId }`) to all of the person's open sessions through the
  gateway: `timer` when their timer started, stopped or was discarded,
  `taskId` for the task whose entries changed. It is a hint to read again,
  spawned on the event broker's shutdown tracker so the response never waits,
  and sent with the person in the request body (a failed request's error
  names its URL). Replayed logs, starts and stops and refused writes send
  nothing; a discard always sends one, since the repository does not say
  whether a timer was there. The agent tools send it too: `ai_tools` gives
  them the same gateway adapter on the host's event broker tracker.
- Reports resolve their scope first (a project's tasks from its Project
  property, or the tasks the people logged on in the period), stop at 5,000
  tasks (`complete: false`), keep the caller's visible ones in one
  `generate_document_view_access_receipts` call, then sum. That check keeps
  trashed documents, so the sums join `"Document"` and leave them out.
  Team is `team_user` read directly, as calendar's team view does: the
  caller's teammates and the caller (a person has at most one team).
- Summaries read the primary (`ReportRead::Latest`): the screens read them
  again after each change, and the replica lags by seconds. Exports read the
  replica. Every report read runs under a five-second statement timeout.
- Reports, like a task's entry list, answer with the rollout off.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`,
  `.agents/rules/observability.md` · Skill: `cloud-storage-hexagonal-architecture`
