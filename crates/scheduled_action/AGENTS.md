# scheduled_action

## What it is

Serves agent sessions' automations ("routines"): the reusable domain and adapters for
scheduled and event-triggered agent automations — cron-style schedules plus
Kafka/Jev-gated event triggers that run a target (agent, workflow) and track
each run.

## Start here

- `src/lib.rs`: module map — `domain`, `inbound`, `outbound`, `swagger`.
- `src/domain/service.rs` + `src/domain/ports.rs`: the orchestration service
  and the ports its adapters implement.
- `src/domain/event_trigger.rs` + `src/domain/target_runner.rs`: how an event
  (Kafka or polled) turns into a dispatched run.
- `src/domain/event_trigger/github_selector.rs`, `payload_match.rs`: the
  `github` selector and the exact payload `match` GitHub filters take.
- `src/domain/event_trigger/property_selector.rs`: the `property` selector task
  property change filters take, matched on the values a change adds.
- `src/inbound/axum_router.rs`, `src/inbound/kafka_consumer.rs`,
  `src/inbound/event_run_worker.rs`: the three inbound adapters.
- `src/domain/templates.rs` + `src/inbound/template_router.rs`: sharing a
  routine as a template and activating it as someone else's routine.
- `services/agent_harness_service/src/scheduling.rs`: the sole runtime host;
  this crate has no deployed binary.

## Scope

- Owns: scheduled-action and event-trigger CRUD, dispatch (in-process or
  tokio), run history, and live-update notifications over the connection
  gateway.
- An authenticated caller with a routine ID can read its detail; listing,
  run history, and mutations stay owner-scoped.
- Templates: the owner shares a snapshot of a routine (keyed by the routine's
  ID) with its references marked as variables; publishing, reading, and activation
  require the caller's `enable-routine-sharing` PostHog flag. Missing flags,
  missing configuration, and failed evaluations return 404. Owner unsharing
  stays available. Activating creates the caller's own routine with `template_id`
  pointing back. Filling variables happens in the client.
- Event triggers follow the owner's `enable-event-routines` PostHog flag
  (`domain/event_rollout.rs`): saving one needs it, and dispatch cancels runs
  (`NotEnabled`) for owners without it. Pausing an event routine never needs
  it. Without PostHog configured, no one has it and the host starts no event
  intake.
- Not here: the target being run (an agent turn, a routine's tool logic) →
  `crates/agent_session`, `ai_tools`; Jev condition evaluation → `crates/jev`.

## Boundaries

- Depends on: `agent_session`, `trigger_context`, `jev`, `channels`, `crm`,
  `documents`, `github` (delivery fact and installation claims only),
  `macro_event_broker`/`macro_event_topics` (Kafka), `macro_db_client`.
- Used by: the web app's automations/routines UI and agent tooling, through
  the gateway.

## Recipes

- Add a new event trigger source: `src/domain/event_trigger.rs` →
  `src/inbound/kafka_consumer.rs` (if Kafka-sourced) →
  `src/outbound/event_content.rs` (decode payload) → test in the matching
  `test.rs` beside each file.
- Add an API route: `src/domain/service.rs` → `src/inbound/axum_router.rs` →
  `src/swagger.rs`.
- Change dispatch behavior: `src/outbound/pg_polling_dispatcher.rs` /
  `src/outbound/tokio_dispatcher.rs` → `src/domain/execution.rs`.

## Checks

- `cargo test -p scheduled_action` (`SQLX_OFFLINE` unset).

The host owns configuration in `services/agent_harness_service/src/scheduling/config.rs`.

## Startup

The harness gates cron polling and event intake on its shared HTTP listener.
`PgPollingDispatcherLifecycle::with_readiness` keeps due work unclaimed until
that listener is ready. Cancellation can stop the gate before startup finishes.

## Gotchas

- A task's `mcp_servers` are apps the routine requires. The owner must have
  each connected: `TargetValidation` checks on save and
  `RoutineSessions::prepare` checks again on every run, then adds them to an
  agent limited to selected apps. An update that omits the key is rejected
  when the stored task has apps (`require_explicit_selection`).
- An agent target is any agent the owner may run: built in, their own, or
  one on a self-hosted runtime. `TargetValidation` authorizes it on save
  without contacting the runtime; `RoutineSessions::prepare` reauthorizes on
  every run, and an offline runtime fails that run in its history.
- Macro events store only ids, plus the GitHub pull request and account behind
  a task status change (`change_source`), and are read again, as the owner, at
  dispatch.
  GitHub deliveries can't be read again, so their event runs keep the bounded
  payload in `event_context`; access for them is the owner's installation
  claim, which needs a linked GitHub account and, for a personal installation,
  that the linked account installed it.
- A `property` filter needs the event's `property_change` (the property and the
  option or entity ids it gained), so runs of routines with one keep it in
  `event_context`; other runs drop it (`EventFilters::run_event`). Free text and
  dates are never kept, so those properties only support any-change filters.
- Enabling a GitHub trigger needs the owner's GitHub link
  (`with_github_links`); without it the service returns `GithubNotLinked`.
- `TODO.md` tracks open follow-ups (unified history list, delete schedules,
  sharing/permissions) — check it before assuming a listed gap is unintentional.
- A new configuration field needs `#[serde(default)]` in `ActionConfiguration`
  and an `Option` in `ActionConfigurationUpdate` that keeps the stored value
  (both reject unknown fields, and older clients omit it), plus every query in
  `pg_scheduled_action_repo.rs` and the event-run claim in `pg_event_run_repo.rs`,
  which builds its own `ScheduledAction`.
- A `once` trigger (stored as `trigger_type = 'once'`, or inside `multiple`)
  runs a single time at `at`, kept to whole seconds. A past `at` is due as soon
  as it is saved, unless the stored routine already consumed it (its
  `next_run_at` moved past `at`), so edits and re-enabling never re-run it.
  After the run `next_run_at` is NULL and the routine stays, shown as completed.
- `PgPollingDispatcher` polls every 30 seconds but wakes earlier for the first
  not-yet-due row a poll saw and for the `next_run_at` of enabled creates and
  updates sent on its in-process `DispatchEvent` channel. Every harness instance
  runs a dispatcher beside the API, so the instance that saved a near-term
  routine runs it within about a second; the claim stays fenced to `next_run_at`.
- Create and update bodies are `ActionConfiguration` and
  `ActionConfigurationUpdate`, with `trigger` required; the cron-only body with a
  top-level `schedule` is gone. Rejections return serde's message, which names
  the field. Cron schedules have 6 or 7 fields.
- The list response carries each routine's `last_run` (latest finished run)
  so clients can flag failures; single reads omit it. Every finished run is
  reported to the owner by the host's `RoutineRunObserver`
  (`services/agent_harness_service/src/scheduling/routine_run_notifications.rs`)
  as an inbox-only `routine_run_finished` notification.
- `template_id` is a plain pointer, not a foreign key: activated routines keep
  it after the template is unshared or its source routine is deleted.
- `run_visibility` is copied onto each run's agent session when the run is
  prepared, so changing it affects later runs only.
- `EventReference` rejects unknown keys, so a replica still on older code can't
  read a run row with a new key: write a new optional key only when it is set.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/guardrails.md`
