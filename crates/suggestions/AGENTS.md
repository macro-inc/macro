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
- The feed, `accept` and `dismiss` (`UserOnly`) serve the person and anyone
  acting for them: a code-mode credential is a Macro API token for the
  person, so it passes. The router labels the caller (`SuggestionCaller`, span
  field `suggestions.caller`): only the person's own session with no program's
  marks (no code-mode invocation, no code-execution header) is `user`; any
  other credential is `agent`. An agent whose signed invocation names a
  generation session not deleted (open, ended and being cleaned up, or
  abandoned), of either kind, gets 403 (`Generating`), since hidden sessions
  only manage the feed through their own tools. The harness refuses to start
  without validating requests' attribution. An agent accepting a background
  prompt suggestion only takes it on (the person runs it from the app); any
  other suggestion becomes done either way.
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
  `by_person`) starts an `suggestion_run` (`RunSessions`, wired in the harness): a
  hidden session of the person's, billed as their agent usage. Anyone acting
  for them (an agent) only takes the suggestion on (`accepted`, no run) for them to
  run. Accept carries the `updatedAt` the card showed; a run starts only if
  the suggestion is unchanged since (409 otherwise). Clicking Run is the approval:
  the run is told never to stop to ask or wait (`run_prompt`), and posts or
  sends only what the suggestion's `sends` says (shown on the card, approved by
  running it), or nothing. A run whose suggestion has no `sends` gets a `no_send`
  scope where the harness mints its credential (`RunScopes`): every service
  refuses its sends and posts. Its progress (`running`,
  `finished`, `failed`) is read from the session on every feed read, never
  stored; the suggestion's `run.sessionId` is where the UI shows the result. `settle_runs` (every 30 s
  in the harness) makes a finished run's suggestion done with the session and what
  it created as `produced`; a failed run leaves the suggestion accepted, and
  accepting it again retries. Retiring or dismissing a suggestion never stops its
  run. Accepting any other suggestion makes it done (`done` in the feed);
  accepting a done suggestion again changes nothing.
- A run is never started twice: a prompt whose answer was lost
  (`RunStartError::Uncertain`) leaves the run for its session to settle; only
  a definite refusal (the prompted session deleted) settles it failed at once.
  `settle_runs` checks runs in turn (`checked_at`) and gives a run up only on
  what is known: past a 10 minute start window, a session confirmed missing
  (`SessionReadError::Missing`, from the stored sessions), or one still waiting
  for its prompt, cut off by a restart (`Disconnected`), or waiting for an
  approval or an answer nobody will give, once it is deleted. A session that
  can't be read is never given up.

## Gotchas

- Gate every entry point on `enable-suggestions` (`SUGGESTIONS_FLAG`). Event resolution
  isn't gated: it only closes suggestions that already exist.
- Deleting a kind's row (for instance a routine suggestion cascading into
  `suggestion_routine`) deletes its suggestion by trigger; reads skip and log a row that
  doesn't decode instead of failing the person's whole feed.
- Texts are checked with `crates/shown_text`: items are named by target, never
  copied into words.
