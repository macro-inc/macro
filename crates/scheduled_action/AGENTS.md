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
  executor, with the owner's access) and at most one agent ("Ask
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
  current version isn't checked again.
- `src/domain/catalog.rs`: `GET /scheduled-actions/catalog?timezone=` serves
  `routine_program`'s catalog to the new-routine flow: each trigger as an
  `ActionTrigger` with schedules in that zone, and code steps only where code
  can be saved.
- `src/domain/drafts.rs` + `src/inbound/draft_router.rs`: `POST
  /scheduled-actions/drafts`, AI drafting a routine, a step to add, or a
  change to a code step from the person's words (Draft it and the step
  boxes in the web editor). It admits the work as automation usage, writes
  through the `DraftModel` port (the harness's `routine_drafts.rs`), checks
  code steps together as saving does, and has the model fix failures up to
  three times; what's left comes back on its step. Before writing code, the
  model names the SDK symbols it will use from the entity indexes, and
  `RoutineCode::symbol_references` adds their full reference (as code mode's
  ReadCodeDocs reads it) and the types they name; without those, nearly
  every first draft failed the type check. The caller sends the
  names and ids the model may use (`Workspace`); saving checks every id.
- `src/domain/suggestions.rs` + `src/inbound/suggestion_router.rs`: routine
  suggestions, `GET /scheduled-actions/suggestions` (starts a generation
  when due), `POST .../suggestions/refresh` and `.../suggestions/{id}/dismiss`.
  A generation reads the person's newest mail from the provider and their
  workspace (a fixed dry-run code step, `suggestions/signals.ts`) and has AI
  pick catalog routines with knob values, or describe a request the
  drafter writes on accept. `suggestions/decode.rs` is the trust boundary:
  only offered catalog keys, bounded one-line knob values that fit their
  knob, and one-line requests survive; `safeDefault` comes from the catalog,
  never from AI. Generations rerun when inboxes, tools or routines change
  (a fingerprint), weekly, or 15 minutes after a failure; one claims the
  person's row, so a late result from an older one is dropped.
  `pg_suggestion_repo.rs` keeps dismissed rows so "not interested" outlives
  each generation.
- `src/domain/code_upgrade.rs`: before a run uses code checked against an
  older version (SDK or `StepContext`), it is checked again, and rewritten by
  a model only if that fails (once per routine and version,
  `scheduled_action_code_upgrade`); a
  failed rewrite pauses the routine. `sweep` does the same for every
  enabled routine when the harness starts after a release.
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
- The list response carries each routine's `last_run`, its latest finished
  run record (what each step did), so clients can flag failures and say what
  it did; single reads omit it. Every finished run is
  reported to the owner by the host's `RoutineRunObserver`
  (`services/agent_harness_service/src/scheduling/routine_run_notifications.rs`)
  as an inbox-only `routine_run_finished` notification.
- Suggestions require the caller's `enable-routine-suggestions` PostHog flag
  on every route, as templates require theirs; nothing is read or generated
  without it. Generation is metered as the non-billable
  `AiFeature::RoutineSuggestions`; drafting a request on accept stays
  automation usage.
- `suggestion_id` (create with `?suggestion_id=`) is a plain pointer like
  `template_id`: it marks that suggestion taken only for the routine's own
  owner, so a forged id hides nothing of anyone else's.
- `template_id` is a plain pointer, not a foreign key: activated routines keep
  it after the template is unshared or its source routine is deleted.
- `run_visibility` is copied onto each run's agent session when the run is
  prepared, so changing it affects later runs only.
- `EventReference` rejects unknown keys, so a replica still on older code can't
  read a run row with a new key: write a new optional key only when it is set.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/guardrails.md`
