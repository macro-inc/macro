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
  boxes in the web editor). The draft runs in a hidden agent session
  (`RoutineSessions`) of the in-process Macro agent: the person's own
  (source `user`, origin `requested`) but hidden, a background session
  (`AgentSession::is_background`) that notifies nobody and
  only the scheduler may delete, never counted as a routine's run. It runs
  as the person, with code mode's tools, on the model their Ask AI steps use
  (`DraftContext::agent_model`), and the session admits and bills its
  turns as agent session usage. In the harness the drafter first finds
  what the words name (`drafts/finding.rs`, `RoutineDrafts::with_finding`):
  a call on the fast model (`finding/find.md`, admitted and billed as the
  person's automation usage through `DraftModel`) names the items the words
  refer to and the SDK areas the routine needs (`RoutineCode::sdk_areas`),
  given up after `FIND_TIMEOUT`. The `NameLookups` port finds each name
  among the kinds it searches (`NameLookups::kinds`), and `settle` keeps
  it only when exactly one item of its likeliest kind has it; a name none
  or several have is left for the person to pick, never guessed. A name
  whose likeliest kind the port doesn't search is not asked; nor is it
  reported or left: the prompt lists it under "Not looked up" and the
  session looks it up with its own tools (`Lookup::unsearched`), so a kind
  the port learns is looked up first with no change here. So is a name a
  likelier kind the lookup couldn't read in full (`NameAnswers::unavailable`,
  or `NameAnswer::unavailable` for that name alone)
  might have (for a name of no likely kind, any kind it couldn't search,
  unless two items already have it), and every name when the lookup
  fails. Names the lookup would refuse (empty past a leading `#`/`@`, over
  200 characters) are never asked. A find that fails, times out or gives
  no answer to read still drafts: the prompt lists every item the request
  names as not looked up (`Lookup::unread`, `routine.draft.find_failed`),
  with the areas that find the commonest items (`LOOKUP_FALLBACK_AREAS`),
  as for a name of no known kind. A background draft cancelled while its
  items are found stops before its session starts
  (`RoutineDrafts::cancelled`). The session is then given instructions
  (`finding/instructions.md`, built by `FindingPrompts`): drafting's rules,
  how to use found and left items (`finding/items.md`: a trigger filter by
  id, a code step's text knob by exact name, Ask AI instructions or a
  condition by name and id; a new item the request asks for is created
  once and used by id), the code-step guide, the catalog's code
  routines marked `example`, and the reference of the routines and `ai` areas.
  They are the same for every draft on one model with the same mix of
  code and conditions, so the agent puts them in its cached prompt prefix
  (`PrepareRoutineSession::instructions`). A code step never messages or
  emails the routine's owner (Macro refuses a message to oneself): telling
  the owner something is an Ask AI step's job. The prompt carries only the
  request, the owner and time, the found and left items, and the reference
  of the areas named, or of the commonest ones when the SDK has none of
  them, then of up to three areas that find the names not looked up (a
  person in `users`, a database in `databases`: `kind_area`), each name's
  likeliest kind first, as the budget allows
  (`RoutineCode::area_reference`). A draft that may not write code
  (`code_available` is false: it needs the SDK, and `DraftContext::code` or
  a request changing a code step) is told to use an Ask AI step instead,
  and its prompt carries only the areas that find the names not looked up:
  it still looks them up.
  Progress reports the admission (`DraftMilestone::Admitted`, which answers
  a background start before anything is looked up) and what was found and
  left by name (`DraftMilestone::Found`). Without finding (tests), the
  prompt is the brief (`brief`): the SDK's routines guide
  (`DraftAgent::guide`, the `@agent` text on `RoutineNamespace` every
  code-mode session reads, so the rules for writing a routine live there,
  not here), the code-step guide, and what is particular to drafting.
  Either way the session hands the routine back by checking it with
  `macro.routines.check` (`POST /scheduled-actions/check`, `check_action`:
  saving's checks, nothing saved), naming what it created. The draft's
  `created` merges what its checks named with what its recorded activity
  shows (`SessionCreations`, read `ACTIVITY_SETTLE` after a turn that ended
  without a passing check, since activity is written asynchronously; a
  passing check already names it), each marked `used` when the routine
  references it, so the review can show items made for nothing or the
  routine's work done early. A check from a draft's session, found from the
  request's code-mode invocation (`RequestSessions`), is kept on its
  `scheduled_action_draft` row (`DraftHandBacks`), so the session and the
  drafter may run on different replicas. The drafter reads the row every
  `POLL` and the session's turn every few polls (it reads the whole log);
  the first passing check ends the draft, else the turn ending does (all
  bounded by `DRAFT_TIMEOUT`). It turns the last passing check (else the
  last check) into the draft (a single agent task, which the SDK still
  accepts, becomes one agent step holding its prompt and user prompt, or
  fails the draft if that step breaks a program's rules; a new routine's
  draft keeps the `appearance` its check picked, dropped when `check_pick`
  refuses it), then stops and deletes the session and the
  row, also once it sees the request dropped mid-draft (the web composer,
  given no answer, sends the draft once more, `compose-routine.ts`);
  `RoutineDrafts::sweep` (every minute in the harness) cleans up drafts
  older than `STALE_DRAFT`, from the rows alone. Saving checks every id
  again. A routine draft's prompt (not the cached instructions: they differ
  per person) lists the apps its owner connected (`drafts/apps.md`, through
  the `DraftApps` port the harness sets with `RoutineDrafts::with_apps`);
  without the port, or when it fails, the draft goes on without the list.
  The session requires (`apps`, the task's `mcp_servers`) the listed ones
  its Ask AI step uses, and names in its check (`missingApps`, kept as
  `RoutineCheck::missing_apps` by `named_missing_apps`: well-formed, not
  already required, at most ten) those it needs that aren't connected; a
  check never fails for them. The draft holds both (`apps`,
  `missing_apps`), sorted again against the listed apps so a required one
  is always connected, and neither when it has no Ask AI step. The
  required apps that aren't connected join the missing ones unbounded, so
  the drafter bounds the list again (`service::missing_apps`) before it
  asks which of them a routine of the owner's can require once connected
  (`DraftApps::requirable`). For an owner on Macro Connect alone, who
  connects every app through Connect, the harness keeps only the apps
  Connect serves; for anyone else it drops an app overlaid with its
  vendor's own MCP server, which connects outside the counted grants. The
  review then asks the person to connect only apps that make the routine
  saveable; when that can't be read, the draft names none. A step draft
  holds no apps. The `routine.draft` span records the drafter (`found` or
  `session`), names found, left and not looked up, the session id,
  checks, items created, the session's tool calls and turns, status
  reads, whether a single
  agent task became steps (`routine.draft.agent_task`), the apps listed,
  required and missing (`routine.draft.connected_apps`, `.apps`,
  `.missing_apps`) and outcome
  (`timeout` included), never the words or the names; `routine.draft.find` records
  the answer's size and `routine.draft.lookup` what it found;
  `routine.check` records whether a check passed and kept a draft's
  answer, and the missing apps it named. `DraftContext` still accepts and ignores the `workspace` older
  web clients send. `bench/` is the drafting eval: 20 requests on a seeded
  workspace, drafted by Draft it and by a bare agent session on a local
  stack against the live model, timed phase by phase and checked three ways
  (the draft's shape, one run of the routine, a blind judge); `compare`
  says win, loss or noise against a baseline (see its README). Run it
  before and after a change to the instructions, the wait or anything else
  on the drafting path. Routine *suggestions* have their own bench,
  `crates/suggestion_generation/bench/`, which reuses `bench/stack.ts`.
- `src/domain/drafts/jobs.rs` + `src/inbound/draft_job_router.rs`:
  background drafts, the same drafter without the waiting request. `POST
  /scheduled-actions/draft-jobs` validates the request and waits only for
  its usage to be admitted (the find call's admission, or a session's
  prompt; the blocking route's 400/402/503,
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
  not the caller's). The job id is also its hidden session's, when it
  drafts in one. Its
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
  finished job's session, or one cut off at `JOB_LIMIT`, is only stopped
  (deleted at once if it won't stop); it is deleted with its row, on
  discard or after `FINISHED_RETENTION` (7 days). `DraftJobs::sweep` fails
  rows still drafting past `INTERRUPTED_AFTER` (their drafter died) and
  deletes abandoned cancels and expired rows; `RoutineDrafts::sweep` skips
  job rows. The drafter reports milestones through `DraftProgress`
  (`drafts/progress.rs`; blocking drafts pass `Unreported`); a `watch`
  writer in the job's task writes each to the row and sends the owner a
  `routine_draft_update` message (`RoutineDraftUpdates`) without blocking
  the drafter, coalescing bursts. Progress carries counts, the trigger and
  step titles, and the names found (as stored) or left (as the person
  wrote them), never code or the request's text. Spans: `routine.draft.start`
  (`routine.draft.repeated` on a start sent again; the job's
  `routine.draft` span is its child), `routine.draft.cancel`,
  `routine.draft.jobs.sweep`, `routine.draft.interrupt`; no owner id
  (it holds an email). Replicas still on code without job rows sweep them
  as stale blocking drafts after `STALE_DRAFT`.
- `src/domain/knob_entities.rs`: the items code steps' entity knobs name,
  checked as the owner through the `KnobEntities` port
  (`outbound/knob_entities.rs` over entity access, and people through
  `KnownPeople`, and trashed documents, tasks, folders and chats through
  `LiveItems`, both of which the harness composes, since an owner keeps their
  grant on what they trashed): `TargetValidation` refuses an unpicked item or one the
  owner can't open on create, check and update, and the program runner
  checks again before each code step that has one, failing it with the
  reason and without running its code; an item several steps pick is
  looked up once a run, the later steps reusing what the first found. `GET
  /scheduled-actions/{id}/unusable-items` lists a saved routine's knobs that
  need a new pick, by step id (not position, so a page editing the routine
  keeps each on its step), with the same reason, for its page. A composition without
  the port refuses entity knobs.
- `src/domain/suggestions.rs` + `src/inbound/suggestion_router.rs`: routine
  suggestions and the tools routines sessions write them with. The sessions
  themselves belong to generations (`crates/suggestion_generation`: an
  onboarding run once the inbox connects, then nightly, and on request), which brief each
  routines session through `RoutineSuggestionApi::brief` (`suggestions/prompt.rs`:
  the routines guide, the catalog for its surfaces, what was dismissed, and the
  newest 100 messages and connected apps inside `<untrusted>` tags, angle
  brackets in the data swapped so it can't close them; a nightly or manual
  brief adds review and retire, and only onboarding's asks for speed; a
  drafted routine is told to start on mail only where saving one can: the
  person has `enable-event-routines` and the deployment evaluates conditions,
  and to add CRM companies only where the person may: in a team whose CRM is
  open to them) and
  count what it suggested (`suggested`). A brief is for a `BriefPart`:
  `Whole` (today's session, which picks and drafts), or, at an onboarding
  with `routine-suggestions-find-work` on, `Picks` (catalog picks only, no
  guide) and `Drafts` (drafted routines only). A `Drafts` brief carries the
  work streams `RoutineSuggestionApi::find_work` found (`suggestions/work.rs`:
  one model call (`WORK_TRIES`: asked once more when its answer strays
  from the list's shape), `WORK_MODEL` thinking little, over the person's last 30
  days of mail, up to 500 messages, the text of the newest 100, read through
  `SuggestionSources::inbox_window`, beside what they sent in those days, up
  to `SENT_MESSAGES` with the text of the newest `SENT_TEXTS`, through
  `SuggestionSources::sent_window`; the answer bounded by `WorkList::from_answer`
  and passed inside `<untrusted>` tags in a fenced `json` block, which the
  harness's Markdown round trip leaves as written: `WorkList::to_brief`
  writes `&` and backticks as JSON escapes), and drafts one routine per stream
  the catalog lacks, at most `MAX_DRAFTS`. The list and the month's mail are
  stored nowhere: the finding call runs inside
  `genai_telemetry::withhold_content`, so its spans carry none of what it
  reads or answers, and the drafting sessions that carry the list are
  prompted with `PromptRoutineSession::withhold_content`
  (`BriefPart::carries_work_list`), so their turns record no content on
  traces either. The list lives in those sessions' prompts (their control
  queue and log) until the generation deletes them as it ends. Its
  fields (senders, cadence, what each asks, what the person does with it and
  to whom, who already handles it) are
  meant to serve other setup suggestions later. A session hands back
  each suggestion through `macro.routines.suggest`
  (`POST /scheduled-actions/suggestions`), reads earlier ones through
  `macro.routines.review()` (`GET .../suggestions/review`) and retires open
  ones through `suggestion.retire(reason)` (`POST .../{id}/retire`); only the
  person's own open routines session in `suggestion_generation_session` may
  (the `GenerationSessions` port, found from the request's code-mode
  invocation like a draft's check; anything else is 403 `NotSuggesting`).
  Suggestions are never rewritten. Each has a stored `state` (`open`,
  `dismissed`, `retired`, `saved`), and only `RoutineSuggestionState::on`
  (`suggestions/state.rs`) moves it: retiring moves only an open one;
  dismissing an open or retired one is for good; saving wins from any state;
  nothing moves back to open. `pg_suggestion_repo::transition` applies it
  under the row's lock (`FOR UPDATE`, never the person's advisory lock), with
  its card's move (`proposed`, `dismissed`, `retired`, `done` with the saved
  routine as `produced`), in one transaction; `create_action` saves the
  owner's suggestion through `pg_suggestion_repo::save` (a template's id or
  someone else's changes nothing). A retired catalog pick may be suggested
  again; an open, dismissed or saved one never. Keeping takes the person's
  advisory lock (`suggestions_db_utils::lock_user`) and counts the session's
  kept suggestions and checks the catalog key under it (`Kept::SessionFull`,
  `Kept::Taken`); the partial unique index
  `routine_suggestion_open_catalog_key_idx` keeps one open pick per key
  against a writer without the lock. A drafted routine comes with its `card`
  (title, importance, categories) and is written with its `routine`
  suggestion in one transaction (`suggestions_db_utils`), refused when that
  would pass the suggestion limits. A catalog pick takes no `card`. Every
  kept and retired suggestion is logged in `suggestion_change`.
  `RoutineSuggestionApi::texts` words drafted routines for the suggestions
  feed (`suggestions/text.rs`): the first code step whose `sentence` reads
  with its knobs (`routine_program::sentence_runs`), else the description or
  name, and `ActionTrigger::describe` (`event_trigger/describe.rs`), the
  first trigger worded as the web app's routine editor words it, in English.
  `suggestions/decode.rs` is the trust boundary: a catalog key with knob values that fit their knob, or a drafted routine that
  passes saving's checks, kept switched off and never acting as the user; a
  one-line reason; no email address, phone number or street address in the
  reason or the drafted routine's words (`shown_text::personal_detail`, by
  shape); the session's surfaces. `GET /scheduled-actions/suggestions?surface=`
  never generates: per surface, drafted routines, then catalog picks (each
  best first, a second with the same catalog title or name left out), then
  catalog routines marked `suggest` as Macro's templates (stable ids,
  `template_id`) to `PER_SURFACE` (drafted routines to `DRAFTED_PER_SURFACE`
  with `routine-suggestions-find-work` on), showing only open AI suggestions and
  skipping dismissed templates (permanent, `.../{id}/dismiss` for either
  kind) and templates saved from (`scheduled_action.suggestion_id`); its
  `status` is the person's latest
  generation's (`GenerationStatuses`). `onByDefault` marks at most two safe
  catalog picks AI rated likely kept, never one that affects others. Spans:
  `routine.suggestions.brief` (with its `part`), `.find_work` (with
  `.read_month`, `.read_sent` and `.list_work` under it), `.suggest`, `.review`,
  `.retire`, `.texts`; log events
  `routine_suggestions.generated` and `.surface` (from `record`, after a
  generation's routines sessions), `.suggested`, `.retired`, `.dismissed`,
  `.saved`.
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
  failed rewrite pauses the routine. A routine whose code writes as its
  owner (`dangerously_operate_as_user`) is never rewritten: it is paused for
  the owner with its code as it was. Nor can a model's rewrite, saved
  unreviewed while the routine wrote as Macro, start writing as the owner:
  switching it on is refused (`UnreviewedRewrite`, 409) while any of its
  code steps still holds code a rewrite wrote, on every save. Only a person
  makes a routine write as them: the create and update routes pass a
  `Requester` (`Program` for a credential signed for an agent or a routine
  run, the code-execution mark, a bot or an internal caller). A program
  can't create an owner-identity routine or sub-routine by any create route
  (checked in `create`), switch a routine to that identity, change an
  owner-identity routine's task or trigger, or switch one on, by update or
  `/enabled` (checked in `replace_configuration`); switching a parent on
  leaves its owner-identity sub-routines off (`follow_parent`)
  (`OwnerIdentityNeedsPerson`, 403). It may rename, describe or switch one
  off. `sweep` does the same for every
  enabled routine when the harness starts after a release.
- `src/domain/event_trigger/github_selector.rs`, `payload_match.rs`: the
  `github` selector and the exact payload `match` GitHub filters take.
- `src/domain/event_trigger/property_selector.rs`: the `property` selector task
  property change filters take, matched on the values a change adds.
- `src/domain/event_trigger/describe.rs`: a trigger in words for a routine
  suggestion's card; a schedule it can't word reads as its cron.
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
  An agent picks a routine's look through `appearance` on create, update
  and check (`ActionConfiguration`, `ActionConfigurationUpdate`; validated by
  `appearance::check_pick`, which names Macro's icons when it refuses one). An
  update applies a pick after saving the configuration, and only when the
  caller acts for the owner; a repeated sub-routine key checks a pick but
  keeps the look the key created. `PUT /appearance` is the owner's choice and
  sets `scheduled_action.appearance_chosen_by_owner`, even for no icon; an
  agent's pick (`AppearanceChooser::Agent`) never replaces it.
  Every change to a look records an `appearance_changed` activity, on this
  code and on replicas built before these columns, which change the look for
  the owner without marking it; `appearance_changes_by_agent` counts the ones
  an agent's pick recorded, so any beyond it are the owner's. A routine from
  before the columns, or one such a replica created, holds NULL in both, and
  a look it has is its owner's. Only an agent's pick reads the activity
  (`pg_activity_repo::appearance_changes_exceed`), in its own statement once
  the row is locked, and no more than one event past the agent's count. A
  refused pick answers with the look read under that lock
  (`AppearanceSet::Kept`), not the one the update loaded.
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
  again on every run, then adds them to an agent limited to selected apps.
  The harness counts the grants connector dispatch would use: enabled rows,
  a Connect grant only where Macro Connect is configured, and for an owner
  on Connect alone only their Connect grants. An update that omits the key is rejected
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
  which builds its own `ScheduledAction`. `appearance` is the exception: an
  agent's pick, written through `ScheduledActionRepo::set_appearance`, not a
  stored configuration field. It is serialized only when set, and kept JSON
  never holds it inside a configuration, which a replica built before it
  rejects: a draft's hand-back check keeps it beside the routine
  (`pg_draft_hand_backs::KeptCheck`), and a kept routine suggestion drops it
  (`decode::drafted_pick`), since suggestions outlive a rollback and one
  unreadable row fails the person's whole list.
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
- `POST /scheduled-actions/{id}/stop` (owner only) stops the routine's run in
  progress, found by its claim (`running_run`); with none running it changes
  nothing. Any instance can serve it, so the stop goes to every instance
  through Postgres `NOTIFY` (`outbound/pg_run_stops.rs`, the `StopRelay`
  port) and `RunStops` (`domain/run_stops.rs`) hands it to the executor,
  which ends that run as `RunEnd::Stopped`: its runner is cancelled, its
  claim released and its record kept with `stopped` set and error "Stopped".
  A stopped event run is `Interrupted`, for good. No notification is sent
  for it. A stop sent while an instance's listener is reconnecting is lost.
- The list response carries each routine's `last_run`, its latest finished
  run record (what each step did), so clients can flag failures and say what
  it did; single reads omit it. Every finished run but a stopped one is
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
- Received mail is for its inbox's owner and for each account that inbox is
  delegated to (multi-inbox, `macro_user_links`): admission asks the
  `InboxDelegates` port (`PgInboxDelegates`) once per event, and only when a
  candidate's owner isn't the inbox's (`event_runs/admission.rs`, `Audience`).
  Like the other audience rules (`IncomingEvent::is_for_owner`), it is never
  an access grant: each owner's entity access is still checked.
- A new-email filter can name `inboxes` (email link ids, at most 25; empty is
  every inbox). Saving checks them against the owner's current own and
  delegated inboxes on create and on a trigger change, so a later disconnect
  never blocks unrelated edits. `OwnerInboxes` asks the email domain's
  `EmailRepo` which of the picked ids the owner reads (`inbox_ids_among`, the
  same own-plus-delegated set the app lists, one index probe per pick), so the
  check never reads the owner's other inboxes or an inbox's other delegates.
  `routine.admit_event` counts the routines only their inboxes turned away as
  `outside_inboxes`. No run keeps the received `inbox`, so every replica can
  read every run: admission checks it, and a filter changed since supersedes
  the run by revision. A shared template drops its inboxes: they are the
  publisher's own. Code without inbox filters can't decode a routine that
  picks some, and skips it at intake.
- `EventReference` rejects unknown keys, so a replica still on older code can't
  read a run row with a new key: write a new optional key only when it is set.
  Its dispatcher fails a whole page of pending runs on one such row, stopping
  every routine's event runs, so don't store what only admission needs, as
  the received inbox.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/guardrails.md`
