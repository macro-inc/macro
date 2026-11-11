# ideas

## What it is

Suggestions: each person's feed of proactive suggestions (a prompt to run, a
note about specific items, or a routine suggestion), written and managed by
hidden generation sessions through `macro.suggestions.*` tools, and read and
acted on by the person. Served by the harness under the scheduler's gateway
prefix (`/scheduled-action/suggestions`); its OpenAPI is merged into the
scheduler's spec.

Naming: the feature was first called Ideas. Everything outside this crate's
code says suggestion: the tables (`suggestion`, `suggestion_prompt`,
`suggestion_entity`, `suggestion_routine` pointing at `routine_suggestion`,
`suggestion_target`), the routes and their schemas, the SDK
(`macro.suggestions`, `Suggestion`) and the `enable-suggestions` flag. The
crate and its Rust types keep the `idea` name; a routine suggestion is still
its own `routine_suggestion` row, which a `routine` suggestion points to.

## How it works

- A generation session calls `review` (every idea, open or not, with limits),
  then `suggest` (add, or update the idea with the same `dedupKey`), `rewrite`
  and `retire`. Only the person's open `ideas` session in
  `suggestion_generation_session` (`GenerationSessions`), found from the
  request's code-mode invocation (`RequestSessions`), may call them; others
  get 403. Reading the feed with `?timezone=` counts the person in for
  nightly generations (`SuggestionAudience`).
- A generation session ends by having each idea it wrote checked against its
  cited items: its last programs call `macro.ai.structuredCompletion` (tool
  free) on the model `IdeaService::with_checker_model` names, which sees only
  the idea and the items' text and lists what the items don't state; the
  session rewrites those ideas. This lives in the brief (`domain/prompt.md`),
  not in code. The calls are the hidden session's, recorded non-billable.
- Code only validates (`domain/check.rs`), stores and logs. Ranking, wording and
  when an idea stops mattering are the session's call; a refused write answers
  `{ ok: false, problems }` the session can act on. Keep it that way: no
  reconciliation, auto-retire or scoring code here.
- The one exception is resolution by events (`domain/resolution.rs`, consumed
  by `inbound/kafka_consumer.rs`, group `ideas-resolution`, run by the
  harness): open ideas are resolved with `state_reason` `replied` (the
  owner's own `email.message_sent` on the thread, or `message.posted` in the
  item or in the idea's thread part, after the idea was created; reply ideas
  only), `deleted` (`document.deleted`/`purged`, `channel.deleted`,
  `message.deleted` for that part, `project.deleted`/`permanently_deleted`) or
  `access_lost` (`channel.participant_removed`, or a document's share
  permissions changing, then only for people `IdeaAccess` now refuses). Keep
  it literal. No event covers email threads being deleted, an inbox being
  disconnected, or team membership; the feed's access filter and the next
  generation session cover those. Resolutions write no `suggestion_change`
  row (that log is for sessions), and a record that keeps failing is skipped.
- Every accepted write adds a `suggestion_change` row (old and new values and
  the session's reason). Changes are silent to the person.

## Start here

- `src/domain/service.rs`: the tools' rules (kind never changes, a dismissed
  idea needs a `reason` to come back, 30 open and 12 new per generation).
- `src/outbound/pg_idea_repo.rs`: base row plus one child table per kind;
  limits are checked under a per-person advisory lock.

## Scope

- Owns: `suggestion`, `suggestion_prompt`, `suggestion_entity`,
  `suggestion_routine`, `suggestion_target`, and its `suggestion_change` rows.
- Also: the vocabulary every generation's tools share (`GenerationTrigger`,
  `SessionKind`, `GenerationSession`) and the `GenerationSessions` and
  `SuggestionAudience` ports, which `crates/suggestion_generation` implements;
  the ideas session's brief (`domain/prompt.md`).
- Not here: generation runs and their sessions → `crates/suggestion_generation`;
  routine suggestions → `crates/scheduled_action`.

## Checks

- `cargo test -p ideas` (live DB, `SQLX_OFFLINE` unset).
- After an API change: regenerate the scheduler's spec and clients (see the
  `add-sdk-endpoint` skill); SDK methods live in `packages/sdk/src/entities/suggestions`.

- Routine ideas: every drafted ("smart") routine suggestion has exactly one,
  written with it by `macro.routines.suggest` through `crates/ideas_db_utils`
  in one transaction; catalog picks never have one. One a replica on the
  previous release drafts during a deploy has none: every path that closes
  a routine idea tolerates a missing one. Dismissing a routine idea
  dismisses its suggestion through `RoutineSuggestionDismissal`; retiring its
  suggestion retires it; saving a routine from the suggestion makes it done
  with the routine as `produced`. Ideas sessions never add, rewrite or retire
  routine ideas.

- Background runs: the person accepting a `prompt` idea with `runMode`
  `background` in the app (their own session, not a program: `Accept`'s
  `by_person`) starts an `idea_run` (`RunSessions`, wired in the harness): a
  hidden session of the person's, billed as their agent usage. Anyone acting
  for them (an agent) only takes the idea on (`accepted`, no run) for them to
  run. Accept carries the `updatedAt` the card showed; a run starts only if
  the idea is unchanged since (409 otherwise). Clicking Run is the approval:
  the run is told never to stop to ask or wait (`run_prompt`), and posts or
  sends only what the idea's `sends` says (shown on the card, approved by
  running it), or nothing. A run whose idea has no `sends` gets a `no_send`
  scope where the harness mints its credential (`RunScopes`): every service
  refuses its sends and posts. Its progress (`running`,
  `finished`, `failed`) is read from the session on every feed read, never
  stored; the idea's `run.sessionId` is where the UI shows the result. `settle_runs` (every 30 s
  in the harness) makes a finished run's idea done with the session and what
  it created as `produced`; a failed run leaves the idea accepted, and
  accepting it again retries. Retiring or dismissing an idea never stops its
  run. Accepting any other idea makes it done (`done` in the feed);
  accepting a done idea again changes nothing.
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

- Gate every entry point on `enable-suggestions` (`IDEAS_FLAG`). Event resolution
  isn't gated: it only closes ideas that already exist.
- Deleting a kind's row (for instance a routine suggestion cascading into
  `idea_routine`) deletes its idea by trigger; reads skip and log a row that
  doesn't decode instead of failing the person's whole feed.
- Texts are checked with `crates/shown_text`: items are named by target, never
  copied into words.
