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
  Each code step's credential says who it writes as (`CodeRun::acts_as`,
  from the task's `dangerously_operate_as_user`) and carries the routine id;
  the run records it as `run.code_acts_as`.
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
  boxes in the web editor). The harness drafts directly
  (`drafts/direct.rs`, `RoutineDrafts::with_direct`), in two or three model
  calls and no session. A call on the fast model (`direct/find.md`) names
  the items the words refer to and the SDK areas the routine needs
  (`RoutineCode::sdk_areas`). The `NameLookups` port (document storage's
  `POST /search/names`, as the person) finds each name, and `settle` keeps
  it only when exactly one item of its likeliest kind has it; a name none
  or several have is left for the person to pick, never guessed. One call
  on the person's Ask AI model (`DraftContext::agent_model`) writes the
  whole routine as JSON from its own system prompt (`direct/write.md`: the
  routines guide, the code-step guide, the SDK's `ai` area and Macro's
  catalog code routines as examples), built once per mix of code and
  trigger conditions (`DirectPrompts`) so the provider caches it; its user
  turn carries the request, the found items by id and the reference of the
  areas named (`RoutineCode::area_reference`). A `setup` module creating
  what the routine uses runs once, as the person, and its ids replace each
  `{{setup.<key>}}`. Saving's checks (`DraftChecks`, the service's
  `check_draft`) run on the result; only their problems, with the SDK
  declarations they name, go back to the model, at most
  `DirectTuning::max_fixes` times. The calls are admitted and billed as
  the person's automation usage (`DraftModel`, `AiFeature::Automation`).
  Progress reports what was found and left by name
  (`DraftMilestone::Found`). Spans: `routine.draft` records drafter
  `direct`, names found and left, checks, fixes and `ended`;
  `routine.draft.call` each call's purpose and answer size;
  `routine.draft.lookup` and `routine.draft.setup`; never the words or the
  names. With it, discarding a job deletes only its row, so a job a
  replica on older code drafted in a session keeps its stopped hidden
  session. Without direct drafting (tests), the draft runs in an ordinary
  hidden agent session (`RoutineSessions`) of the in-process Macro agent:
  the person's own
  (source `user`, origin `requested`) but hidden, a background session
  (`AgentSession::is_background`) that notifies nobody and only the scheduler
  may delete, never counted as a routine's run. It runs as the person, with its usual
  tools, on the model their Ask AI steps use (`DraftContext::agent_model`);
  the session admits and bills its turns as agent session usage. One
  prompt, the brief (`brief`): the SDK's routines guide (`DraftAgent::guide`,
  the `@agent` text on `RoutineNamespace` every code-mode session reads, so
  the rules for writing a routine live there, not here), the code-step guide,
  and only what is particular to drafting: leave out an item it can't
  match exactly, and hand the routine back by checking it with `macro.routines.check`
  (`POST /scheduled-actions/check`, `check_action`: saving's checks, nothing
  saved), naming what it created. The draft's `created` merges what its
  checks named with what its recorded activity shows (`SessionCreations`,
  read `ACTIVITY_SETTLE` after the turn stops, since activity is written
  asynchronously), each marked `used` when the routine references it, so the
  review can show items made for nothing or the routine's work done early. A check from a draft's
  session, found from the request's code-mode invocation (`RequestSessions`),
  is kept on its `scheduled_action_draft` row (`DraftHandBacks`), so the
  session and the drafter may run on different replicas. The drafter reads
  the row every `POLL` and the session's turn every few polls (it reads the
  whole log); the first passing check ends the draft, else the turn ending
  does (all bounded by `DRAFT_TIMEOUT`). It turns the last
  passing check (else the last check) into the draft, then stops and deletes
  the session and the row, also once it sees the request dropped mid-draft
  (the web composer, given no answer, sends the draft once more,
  `compose-routine.ts`);
  `RoutineDrafts::sweep` (every minute in the harness) cleans up drafts
  older than `STALE_DRAFT`, from the rows alone. Saving checks every id
  again. The `routine.draft` span records the session id, checks, items
  created, the session's tool calls and turns, status reads and outcome
  (`timeout` included), never the words; `routine.check` records
  whether a check passed and kept a draft's answer. `DraftContext` still
  accepts and ignores the `workspace` older web clients send. `bench/`
  times drafting on a local stack against the live model, phase by phase,
  and checks the drafts (see its README); rerun it when changing the brief
  or the wait.
- `src/domain/drafts/jobs.rs` + `src/inbound/draft_job_router.rs`:
  background drafts, the same drafter without the waiting request. `POST
  /scheduled-actions/draft-jobs` validates the request and waits only for
  the session's prompt to be admitted (the blocking route's 400/402/503,
  plus 409 past `MAX_DRAFTING` drafting at once), then answers 202 with the
  job. The body carries a client-made `clientId`; a start sent again with
  it (the client resends when its connection drops) answers with the live
  job that start began and creates no session (`client_id` and a unique
  index per owner on the row). `DraftJobStore::begin_job` checks the
  repeat, counts and inserts in one transaction under a per-owner advisory
  lock, so starts sent together never pass the limit, and a repeat answers
  before the limit; it counts jobs drafting that started within
  `INTERRUPTED_AFTER`, through the owner's jobs index. `GET` lists
  drafting and unopened finished ones, `GET .../{id}` reads one (its
  `Draft` when ready), `DELETE .../{id}` cancels or discards one (404 when
  not the caller's). The job id is its hidden session's. Its
  state, request (kind and words), progress, result, `finished_at` and the
  starting `traceparent` live on its `scheduled_action_draft` row
  (`DraftJobStore`, `state` NULL for a blocking draft, which keeps its old
  lifecycle). It runs on the receiving replica's `TaskTracker` under the
  shutdown token: shutdown fails it as interrupted. The start's own body,
  from the insert to admission, runs on the tracker too, so a dropped
  request can't leave a row without its drafter. The drafter is cut off at
  `JOB_LIMIT` (`DRAFT_TIMEOUT` + 60 s) and fails its job as timed out; its
  result write is tried three times. `INTERRUPTED_AFTER` is 60 s past
  `JOB_LIMIT`. A cancel from any replica marks the row `cancelled`; the
  drafter sees it on its next row read (`HandedBack::cancelled`) and
  deletes the session and the row, and its last update to the owner is
  `removed`, as is that of a job whose admission was refused. A
  finished job's session is only stopped; it is deleted with its row, on
  discard or after `FINISHED_RETENTION` (7 days). `DraftJobs::sweep` fails
  rows still drafting past `INTERRUPTED_AFTER` (their drafter died) and
  deletes abandoned cancels and expired rows; `RoutineDrafts::sweep` skips
  job rows. The drafter reports milestones through `DraftProgress`
  (`drafts/progress.rs`; blocking drafts pass `Unreported`); a `watch`
  writer in the job's task writes each to the row and sends the owner a
  `routine_draft_update` message (`RoutineDraftUpdates`) without blocking
  the drafter, coalescing bursts. Progress carries counts, the trigger and
  step titles, never code or the words. Spans: `routine.draft.start`
  (`routine.draft.repeated` on a start sent again; the job's
  `routine.draft` span is its child), `routine.draft.cancel`,
  `routine.draft.jobs.sweep`, `routine.draft.interrupt`; no owner id
  (it holds an email). Replicas still on code without job rows sweep them
  as stale blocking drafts after `STALE_DRAFT`.
- `src/domain/suggestions.rs` + `src/inbound/suggestion_router.rs`: routine
  suggestions, the Draft pattern. `POST /scheduled-actions/suggestions/generate`
  (onboarding calls it once the inbox connects) starts the person's one
  generation ever: hidden background sessions of the in-process Macro agent,
  as the person, three at once by surface group (`SuggestionLayout`: email,
  calendar, tasks; crm, calls, chat; files, reviews, agents), each capped at
  `SESSION_TIMEOUT` (240 s), handing back catalog picks first, then drafts.
  A prompt whose delivery is unknown ends the session like a failure, so it
  gets the one retry. Each brief (`suggestions/prompt.rs`) holds the
  routines guide, the catalog for its surfaces, what was dismissed, and the
  newest 100 messages and connected apps inside `<untrusted>` tags (angle
  brackets in the data are swapped so it can't close them). A session hands
  back each suggestion through `macro.routines.suggest`
  (`POST /scheduled-actions/suggestions`), which only the person's own open
  suggestion session may call (`routine_suggestion_session`, found from the
  request's code-mode invocation like a draft's check; anything else is 403
  `NotSuggesting`). `suggestions/decode.rs` is the trust boundary: a catalog
  key with knob values that fit their knob, or a drafted routine that passes
  saving's checks, kept switched off and never acting as the user; a one-line
  reason; no email address, phone number or street address in the reason or
  the drafted routine's words (`personal_detail`, by shape); the session's
  surfaces. A session that keeps
  nothing is retried once; then Macro's templates fill in. `GET
  /scheduled-actions/suggestions?surface=` never generates: per surface,
  drafted routines, then catalog picks (each best first, a second with the
  same catalog title or name left out), then catalog routines marked `suggest` as
  Macro's templates (stable ids, `template_id`) to `PER_SURFACE`, skipping
  dismissed (permanent, `.../{id}/dismiss` for either kind) and saved ones
  (`scheduled_action.suggestion_id`). `onByDefault` marks at most two safe
  catalog picks AI rated likely kept, never one that affects others. Unlike a draft's, a suggestion session
  is prepared with `SessionBilling::NonBillable`, so its turns are
  recorded as the non-billable `NonBillableAgentSession`, never billed as
  agent session usage. The sweep deletes sessions a stopped
  process left open. Spans: `routine.suggestions.generate`, `.session`,
  `.suggest`; log events `routine_suggestions.generated`, `.suggested`,
  `.dismissed`, `.saved`.
- The `routine_suggestions.*` INFO logs (`suggestions.rs`, and `saved` in
  `service.rs`, which names the suggestion through the `SuggestionOrigins`
  port the harness sets with `with_suggestion_origins`) are the field
  contract of `infra/stacks/monitoring/monitors/routine-suggestions.ts`;
  renaming an event or field empties its dashboard or alert.
- `src/domain/service/sub_routines.rs` +
  `src/outbound/pg_scheduled_action_repo/sub_routines.rs` (the `SubRoutines`
  port): sub-routines. A routine created by a routine's run in progress is
  that routine's sub-routine (`ScheduledAction::sub_routine`: `parent_id`,
  `created_by_run_id`, `key`, `paused_by_parent`). The create's credential
  proves the run, never its body (`RunCaller`): a code step's token is signed
  for its routine (`agent_correlation::context::current_routine`), and an Ask
  AI step's code-mode invocation resolves to its session (`RequestSessions`),
  whose id is the run's id. A run's id is its claim's token
  (`ExecutionHandle::for_run`): the session its agent step opens and its
  history record take it, so `scheduled_action.claim_token` names the run in
  progress and nothing matches once the claim is released. A routine made
  from a chat, another session, the `CreateRoutine` tool or a session someone
  continues after its run ended stays top-level. One level: a sub-routine's
  run creates siblings under the same top-level parent, each recording its
  own creating run. `?key=` on create upserts within the parent (a unique
  index decides races; a key outside a run is 400 `KeyOutsideRun`). At most
  `MAX_ACTIVE_SUB_ROUTINES` (50) active ones per parent, counted under a lock
  on the parent row; a finished one-time one (`is_finished_once`: a `once`
  trigger with no next run) doesn't count, and the refusal is 409
  `TooManySubRoutines`. Switching a parent off switches its enabled
  sub-routines off and marks them `paused_by_parent`; switching it on resumes
  only those (`follow_parent`, also the code-upgrade pause in
  `pg_code_upgrades.rs`). Deleting a parent deletes its sub-routines with
  their grants and registry rows (`delete_action`; the foreign key's cascade
  is only the fence against a racing create). `POST
  /scheduled-actions/{id}/detach` ("Keep as my routine") clears the link. The
  list returns top-level routines; `include_children` adds their active
  sub-routines and `parent=` returns one routine's, active ones plus its
  newest 200 finished one-time ones. Finished ones accumulate without bound,
  so every read of active sub-routines repeats the predicate of the partial
  index `scheduled_action_active_children_idx` and never touches them; history rows carry `created`, the sub-routines that run created
  (`created_by_runs`). A sub-routine's run notification names its parent
  (`FinishedRoutineRun::parent_name`). Spans: `routine.create` (parent, run,
  keyed, outcome `created`/`updated`/`refused_cap`), `routine.follow_parent`,
  `routine.detach`.
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
- Reading a routine, listing, run history, and mutations are owner-scoped:
  ID routes take a `ScheduledActionAccessExtractor` receipt and the domain
  loads the routine only for its owner (`granted_action`). Without a grant
  they answer 401; with a grant but not the owner, 404.
- Appearance writes atomically record history through the activity adapter without changing configuration revisions, scheduling state, or content timestamps; routine deletion removes that history in the same transaction.
- Templates: the owner shares a snapshot of a routine (keyed by the routine's
  ID) with its references marked as variables; publishing, reading, and activation
  require the caller's `enable-routine-sharing` PostHog flag. Missing flags,
  missing configuration, and failed evaluations return 404. Owner unsharing
  stays available. Activating creates the caller's own routine with `template_id`
  pointing back and the published appearance snapshot. Filling variables happens
  in the client.
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
- GitHub presets do not configure subscriptions: use `../github/README.md`
  and `../github/app-webhooks.json` for App registration and permission approval.
  Keep event names open so new subscriptions need no routine parser changes.
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
- `template_id` is a plain pointer, not a foreign key: activated routines keep
  it after the template is unshared or its source routine is deleted.
- `run_visibility` is copied onto each run's agent session when the run is
  prepared, so changing it affects later runs only.
- An event stamped with a `routine_id` (a routine run's write, even one
  operating as its owner) never starts a routine: `IncomingEvent::normalize`
  rejects it as `RoutineWrite`, for any routine, so two can't trigger each
  other. Mail received, internal hops and sync-service document edits carry
  no stamp.
- `EventReference` rejects unknown keys, so a replica still on older code can't
  read a run row with a new key: write a new optional key only when it is set.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/guardrails.md`
