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
- `src/domain/program_runner.rs`: runs a routine's steps (`crates/routine_program`)
  in order: code steps through the `RoutineCode` port (the harness's Deno
  executor, limited to each step's `writes`) and at most one agent ("Ask
  AI") step through `target_runner.rs`. An old single-agent task runs as one
  agent step. Event trigger conditions are answered before a run starts
  (`event_runs/condition.rs`), not by the runner.
  `run_context` builds what code receives: the trigger's time (not the
  clock), the schedule's zone or else the owner's, and the previous run
  (`ScheduledActionRepo::run_history`, skipped runs excluded). Every tool and
  code step's output is recorded on its step and the run records its `run`
  info, for the run page.
- `src/domain/code_check.rs`: saving a routine gives its steps ids, type-checks
  all its code steps together and stamps the task's `sdk` (the version from
  `routine_program::code_version`); unchanged code already checked against the
  current version isn't checked again. `POST /scheduled-actions/code/guide`
  (the shared code-step text, `StepContext` and the SDK reference for a
  task) and `/code/check` (the same check of a drafted `steps` list, without
  saving, with problems by code step) serve the web routine drafter.
- `src/domain/code_upgrade.rs`: before a run uses code checked against an
  older version (SDK or `StepContext`), it is checked again, and rewritten by
  a model only if that fails (once per routine and version,
  `scheduled_action_code_upgrade`); a
  failed rewrite pauses the routine. `sweep` does the same for every
  enabled routine when the harness starts after a release.
- `src/domain/event_trigger/github_selector.rs`, `payload_match.rs`: the
  `github` selector and the exact payload `match` GitHub filters take.
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

- A task's `mcp_servers` (beside a program's `steps`, or on an old
  single-agent task) are apps the routine requires, handed to its agent step;
  a program with apps needs one. The owner must have each connected:
  `TargetValidation` checks on save and `RoutineSessions::prepare` checks
  again on every run, then adds them to an agent limited to selected apps. An update that omits the key is rejected
  when the stored task has apps (`require_explicit_selection`).
- Macro events store only ids and are read again, as the owner, at dispatch.
  GitHub deliveries can't be read again, so their event runs keep the bounded
  payload in `event_context`; access for them is the owner's installation
  claim, which needs a linked GitHub account and, for a personal installation,
  that the linked account installed it.
- Enabling a GitHub trigger needs the owner's GitHub link
  (`with_github_links`); without it the service returns `GithubNotLinked`.
- `TODO.md` tracks open follow-ups (unified history list, delete schedules,
  sharing/permissions) — check it before assuming a listed gap is unintentional.
- A new configuration field needs `#[serde(default)]` in `ActionConfiguration`
  and an `Option` in `ActionConfigurationUpdate` that keeps the stored value
  (both reject unknown fields, and older clients omit it), plus every query in
  `pg_scheduled_action_repo.rs` and the event-run claim in `pg_event_run_repo.rs`,
  which builds its own `ScheduledAction`.
- `template_id` is a plain pointer, not a foreign key: activated routines keep
  it after the template is unshared or its source routine is deleted.
- `run_visibility` is copied onto each run's agent session when the run is
  prepared, so changing it affects later runs only.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/guardrails.md`
