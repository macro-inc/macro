# suggestions

## What it is

Suggestions: each person's feed of proactive suggestions (a prompt to run, a
note about specific items, or a routine suggestion), written and managed by
hidden generation sessions through `macro.suggestions.*` tools, and read and
acted on by the person. Served by the harness under the scheduler's gateway
prefix (`/scheduled-action/suggestions`); its OpenAPI is merged into the
scheduler's spec.

## How it works

- A generation session calls `review` (every suggestion, open or not, with limits),
  then `suggest` (add, or update the suggestion with the same `dedupKey`), `rewrite`
  and `retire`. Only the person's open `suggestions` session in
  `suggestion_generation_session` (`GenerationSessions`), found from the
  request's code-mode invocation (`RequestSessions`), may call them; others
  get 403. Reading the feed with `?timezone=` counts the person in for
  nightly generations (`SuggestionAudience`).
- The feed (`GET /suggestions`) is `{ suggestions, done, counts }`: open
  suggestions best first, then those done in the last day, most recently
  first (a finished run makes its suggestion done in the same write).
  `?limit` caps the open list and leaves `done` out; `counts` (`open`,
  `running`, `failed`, `done`) counts every suggestion shown either way. Each
  carries its server-computed `status` (`open`, `running` while its latest run
  is unsettled, a restored suggestion's run still being cancelled included,
  `failed`, `done`; `closed` only in `review`, `SuggestionStatus::of`), its
  latest `run` as stored, and, while it is `done` or `failed`, its `result`
  (`result_of`: what its latest, finished run made over its session, never an
  earlier run's item; its failed run's session; or without a run what acting
  on it made; none while open, even after an old run settled).
  Reading it never calls a session or reads an item. A suggestion one of whose
  items can't be checked is left out and logged, never failing the feed. Each
  process keeps a person's flag for 60 s and counts them in at most once an
  hour per time zone (`Recent`).
- A reply suggestion carries `waitingSince` and `from` (the sender's name,
  never an address): its email thread's newest message, or its channel
  message, unless the person sent it, read when a session writes it
  (`ReplyWaits`, `outbound/reply_waits.rs`, wired in the harness; kept as it
  was when the item can't be read) and cleared when it is resolved. Its draft
  carries `preview`, the first 300 characters of its plain text, read when it
  is attached.
- The person takes back a dismissal within five minutes
  (`POST /suggestions/{id}/restore`, lifecycle event `undismiss`): it is
  proposed again, and a run the dismissal cancelled stays cancelled, so a new
  one starts once that settles: until then it shows `running`, and accepting
  it answers 409 with it as it is. A routine suggestion isn't restored (409):
  its routine suggestion has no way back.
- The feed, `accept`, `dismiss` and `restore` (`UserOnly`) serve the person and anyone
  acting for them: a code-mode credential is a Macro API token for the
  person, so it passes. The router labels the caller (`SuggestionCaller`, span
  field `suggestions.caller`): only the person's own session with no program's
  marks (no code-mode invocation, no code-execution header) is `user`; any
  other credential is `agent`. An agent whose signed invocation names a
  generation session not yet deleted (open, or ended and being cleaned up), of
  either kind, gets 403 (`Generating`), since hidden sessions only manage the
  feed through their own tools. The harness refuses
  to start without validating requests' attribution. An agent accepting a
  background prompt suggestion only takes it on (the person runs it from the app);
  any other suggestion becomes done either way.
- New since the last visit: the app sends `POST /suggestions/viewed` once the
  feed is on screen, which stores the time in `suggestion_feed_view` (one row
  per person; a time never goes back). The feed marks an open suggestion
  `isNew` when it is proposed and became proposed after that time (every
  proposed one before the first visit): one added or brought back is new, one
  rewritten keeps its mark. Only the feed sets `isNew`; anywhere else it is
  false. Generation sessions are refused, as for the feed.
- A generation session ends by having each suggestion it wrote checked against its
  cited items: its last programs call `macro.ai.structuredCompletion` (tool
  free) on the model `SuggestionService::with_checker_model` names, which sees only
  the suggestion and the items' text and lists what the items don't state; the
  session rewrites those suggestions. This lives in the brief (`domain/prompt.md`),
  not in code. The calls are the hidden session's, recorded non-billable.
- Code only validates (`domain/check.rs`), stores and logs. Ranking, wording and
  when a suggestion stops mattering are the session's call; a refused write answers
  `{ ok: false, problems }` the session can act on. Keep it that way: no
  reconciliation, auto-retire or scoring code here.
- The one exception is resolution by events (`domain/resolution.rs`, consumed
  by `inbound/kafka_consumer.rs`, group `suggestions-resolution`, run by the
  harness): open suggestions are resolved with `state_reason` `replied` (the
  owner's own `email.message_sent` on the thread, or `message.posted` in the
  item or in the suggestion's thread part, after the suggestion was created; reply suggestions
  only), `deleted` (`document.deleted`/`purged`, `channel.deleted`,
  `message.deleted` for that part, `project.deleted`/`permanently_deleted`) or
  `access_lost` (`channel.participant_removed`, or a document's share
  permissions changing, then only for people `SuggestionAccess` now refuses). Keep
  it literal. No event covers email threads being deleted, an inbox being
  disconnected, or team membership; the feed's access filter and the next
  generation session cover those. Resolutions write no `suggestion_change`
  row (that log is for sessions), and a record that keeps failing is skipped.
- Every accepted write adds a `suggestion_change` row (old and new values and
  the session's reason). Changes are silent to the person.
- Reply drafts: a suggestions session may write a reply as the person
  (`macro.email.createDraft`, never sent) and attach it to an open entity
  suggestion with action `reply` (`PUT /suggestions/{id}/draft`, `suggestion.attachDraft`). The
  draft must be an unsent draft in one of the person's own inboxes (not a
  delegated one; `SuggestionDrafts`, read through the email domain's `EmailRepo`),
  in an email thread the suggestion is about. It is stored as the `suggestion_target` of
  role `draft` (the thread, with the draft as the part); a new one replaces
  it, logged as `rewritten` with `{"draft": ...}` before and after. While a
  suggestion has a draft, its `about` keeps the draft's thread. A sent draft
  resolves the suggestion through `email.message_sent` on that thread, like any
  reply. Deleting a draft publishes no event (`email.message_deleted` comes
  only from provider sync), so the link stays until a session replaces it.

## Start here

- `src/domain/service.rs`: the tools' rules (kind never changes, a dismissed
  suggestion needs a `reason` to come back, 30 open and 12 new per generation).
- `src/outbound/pg_suggestion_repo.rs`: base row plus one child table per kind;
  limits are checked under a per-person advisory lock.

## Scope

- Owns: `suggestion`, `suggestion_prompt`, `suggestion_entity`,
  `suggestion_routine`, `suggestion_target`, `suggestion_run`,
  `suggestion_feed_view`, and its `suggestion_change` rows.
- Also: the vocabulary every generation's tools share (`GenerationTrigger`,
  `SessionKind`, `GenerationSession`) and the `GenerationSessions` and
  `SuggestionAudience` ports, which `crates/suggestion_generation` implements;
  the suggestions session's brief (`domain/prompt.md`, with a line per trigger:
  only onboarding's asks for speed), and `SuggestionApi::feed_changes`, what
  a suggestions session changed in the feed.
- Not here: generation runs and their sessions → `crates/suggestion_generation`;
  routine suggestions → `crates/scheduled_action`.

## Checks

- `cargo test -p suggestions` (live DB, `SQLX_OFFLINE` unset).
- After an API change: regenerate the scheduler's spec and clients (see the
  `add-sdk-endpoint` skill); SDK methods live in `packages/sdk/src/entities/suggestions`.

- Routine suggestions: every drafted ("smart") routine suggestion has exactly one,
  written with it by `macro.routines.suggest` through `crates/suggestions_db_utils`
  in one transaction; catalog picks never have one. One a replica on the
  previous release drafts during a deploy has none: every path that closes
  a routine suggestion tolerates a missing one. Dismissing a routine suggestion
  dismisses its suggestion through `RoutineSuggestionDismissal`; retiring its
  suggestion retires it; saving a routine from the suggestion makes it done
  with the routine as `produced`. Suggestions sessions never add, rewrite or retire
  routine suggestions.

- Background runs: the person accepting a `prompt` suggestion with `runMode`
  `background` in the app (their own session, not a program: `Accept`'s
  `by_person`) starts a `suggestion_run` (`RunSessions`, wired in the harness): a
  hidden session of the person's, billed as their agent usage. Anyone acting
  for them (an agent) only takes the suggestion on (`accepted`, no run) for them to
  run. Accept carries the `updatedAt` the card showed; a run starts only if
  the suggestion is unchanged since and no run of it is unsettled (409 with
  it as it is now otherwise). Clicking Run is the approval:
  the run is told never to stop to ask or wait (`run_prompt`), and posts or
  sends only what the suggestion's `sends` says (shown on the card, approved by
  running it), or nothing. The run row keeps the `sends` it started with; a run
  started with none gets a `no_send` scope where the harness mints its
  credential (`RunScopes`, read from that snapshot): every service refuses its
  sends and posts. While a run is unsettled, a rewrite of the suggestion's
  `prompt` or `sends` is refused (`{ ok: false }`, `Written::RunGoing`).
- Runs move only through the run state machine (`domain/run.rs`, one table of
  `(state, event) → (state, effect)`): `starting` → `running` ⇄ `waiting` →
  `finished` or `failed`, plus `stopping` (over its time: stop it, delete it
  after a 5 minute grace, end `failed`) and `cancelling` (its suggestion closed:
  end `cancelled`). A run gets 10 minutes to start, 10 minutes waiting
  (counted from when it began waiting) and 60 minutes in all. The state and
  when it was entered are stored, so the feed never asks a session. Every move
  compares and sets the state it read, under a 2 minute hold
  (`claimed_until`), so two processes never act on one run; its effect (read
  what it made, stop, delete) runs before it lands. A run is stored already
  held by the accept that starts it, so a dismissal while its session opens
  only cancels it, and the start stops what it opened (reading the run back
  when its answer was lost; a session that opens after its run settled or
  went is deleted); a missing session
  settles no stopping or cancelling run within its 10 minutes to start, since
  one may still open and take the prompt. A finished run makes an
  accepted suggestion done with the session and what it created as `produced`
  (each item once, at most 200; the harness reads every page of the session's
  activity); a failed run leaves it accepted, and accepting it again runs it
  again.
- Runs move from their sessions' lifecycle events (`inbound/run_consumer.rs`,
  group `suggestions-runs`, `macro.agent_session_lifecycle`: settled, waiting
  for input, command rejected, stopped, deleted) and from a reconcile sweep
  every 5 minutes in the harness (`SuggestionRuns::reconcile_runs`, at most 200
  runs, least recently checked first) that reads each unsettled run's session,
  for missed events and runs over their time. One run's error, or a row that
  doesn't decode (skipped, logged and marked checked so it doesn't hold the
  front), never stops the sweep. A finish takes
  the suggestion's row before the run's, as closing a suggestion does, so the
  two never deadlock. A run is never started twice: a prompt whose answer was lost
  (`RunStartError::Uncertain`) stays `starting` for its session to settle; only
  a definite refusal fails it at once. A session that can't be read is given
  up only past the run's time.
- Dismissing, retiring or resolving a suggestion moves its unsettled run to
  `cancelling` in the same write (`lifecycle::cancels_run`); dismiss and retire
  also stop its session at once, resolve leaves that to the sweep. A cancelled
  run that finishes never makes its suggestion done, even one restored and
  taken on again since; it records what it made. Accepting any other
  suggestion makes it done (`done` in the feed); accepting a done suggestion
  again changes nothing.
- Every state write follows the suggestion lifecycle table
  (`domain/lifecycle.rs`): the service asks it where an event moves a
  suggestion, and each SQL guard allows exactly its sources
  (`pg_suggestion_repo/test/lifecycle.rs` tries every write from every state
  against it).

## Gotchas

- Gate every entry point on `enable-suggestions` (`SUGGESTIONS_FLAG`). Event resolution
  isn't gated: it only closes suggestions that already exist.
- Deleting a kind's row (for instance a routine suggestion cascading into
  `suggestion_routine`) deletes its suggestion by trigger; reads skip and log a row that
  doesn't decode instead of failing the person's whole feed.
- Texts are checked with `crates/shown_text`: items are named by target, never
  copied into words.
