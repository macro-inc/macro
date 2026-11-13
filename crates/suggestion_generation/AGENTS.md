# suggestion_generation

## What it is

Generations for Suggestions and routine suggestions: runs of hidden agent sessions,
at onboarding, in each person's night and when they ask for fresh suggestions, that
write their suggestions (`crates/suggestions`) and routine suggestions
(`crates/scheduled_action`) through those crates' tools. Hosted by the harness's
scheduling runtime.

## How it works

- Three triggers start a generation (`GenerationTrigger`): `onboarding`
  (`POST /scheduled-action/suggestions/generate?timezone=`, once the inbox
  connects), `nightly` (the tick, `GenerationService::nightly`, every five
  minutes in the harness) and `manual`
  (`POST /scheduled-action/suggestions/regenerate?timezone=`). A generation is
  one `suggestion_generation` row, then one suggestions session and routines
  sessions at once (at onboarding one per `SessionLayout` group, for speed;
  otherwise one for every surface, for cost), each kind only when its flag is
  on (`enable-suggestions`, `enable-routine-suggestions`).
- Each session is hidden, the person's, non-billable, and may call its kind's
  tools while its `suggestion_generation_session` row is open. Its brief comes
  from the kind's crate (`SuggestionApi::brief`, `RoutineSuggestionApi::brief`),
  which words it for the trigger: only onboarding says the person is waiting.
- Code here only schedules, waits, cleans up and logs. The sessions do all
  judging through the tools; no reconciliation, ranking or retiring here.
- The lifecycles are pure tables in `src/domain/`, each tested over every
  pair, and storage guards every write with them (see **State machines**).
- Nightly: people on a paid plan (`Plans`, from AI billing's entitlements)
  seen in the last week (`suggestion_audience`: an app load with suggestions on,
  `POST /scheduled-action/suggestions/seen?timezone=` from the web app, the onboarding start, and suggestions feed
  reads with a time zone, the last through `audience::PaidAudience`). Each
  row stores `next_run_at`, a time of the person's own inside 2 to 5 am in
  their zone (`night.rs`), and `last_outcome`. The tick reads only who is
  due, longest waiting first, keeps reading while people are dropped or
  passed over, and records each person's outcome with their next run
  (`nightly::decide`). A nightly run includes the routines session once a
  week (`ROUTINES_EVERY`, from `last_routines_ok_at`); other nights only the
  suggestions session runs. Onboarding runs for every plan.
- Fresh suggestions on request (`manual`): for anyone with `enable-suggestions`,
  whatever their plan; at most once per `REGENERATE_EVERY` (an hour) from their
  last manual start, never while any of their generations runs (409
  `{ reason: "running" }`, 429 `{ availableAt }` with `Retry-After`, 404 with
  suggestions off). It runs like a nightly one (one session for every surface,
  nightly timeouts) with its own brief line, and includes the routines
  session only when the week's are due. `GET /scheduled-action/suggestions/generation`
  is what the web app shows and polls: `state`, the running one's `trigger`
  and `startedAt`, the last ended one's `lastFinishedAt` and `lastOutcome`,
  and `regenerateAvailableAt` while a manual run is held back.
- Capacity: at most `MAX_NIGHTLY_RUNS` nightly runs per process; with the
  harness's two processes and a tick every five minutes that starts about 48
  people an hour, roughly 150 per zone's three-hour night. Manual and
  onboarding runs take no nightly place. The `suggestion.nightly_short`
  warning counts people due but not started (missed or waiting).
- A running generation beats a heartbeat (`HEARTBEAT`, 30 s). The sweep marks
  one silent for `HEARTBEAT_LOST` (3 min) `interrupted`, ends the sessions it
  left open, and retries deletes that failed (`CLEANUP_RETRY` apart, up to
  `MAX_CLEANUP_ATTEMPTS`, then `abandoned`). A stopping process records its
  generations `cancelled` before it cleans up their sessions. Either way the
  next start of that trigger is the next attempt, with a new id, up to
  `MAX_ATTEMPTS`; a nightly one cut short is due again at once.
- Generation sessions are scoped where their code-mode credential is minted
  (`agent_correlation::scope::SessionScope::Generation`, decided by the
  harness's `SessionScopes`) until their row is deleted: every service refuses
  their requests other than reads, their own tools and email drafts, and the
  native tool gate their non-code tools. A new session tool route goes on the
  scope's list.
- Traces: an onboarding or manual generation is a child of the request that
  started it; a nightly one is its own root span linked to the tick. Its trace
  id is kept on `suggestion_generation.trace_id` and recorded as
  `suggestion.generation.trace_id` on every session tool call (they reach
  the API without the trace's context). `user.id` is the person's opaque
  account id. The sweep deletes change-log entries older than
  `CHANGES_KEPT` (90 days), a batch at a time.
- `POST /scheduled-action/scheduled-actions/suggestions/generate` is the
  retired onboarding route, kept for old web and app bundles: it starts
  onboarding and answers with routine suggestions. It is not in the spec;
  remove it once no bundle calls it.

## State machines

- Generation (`generation.rs`): `generating` → `ready` (every session
  finished) | `partial` (some finished, or something changed) | `failed`
  (nothing) | `cancelled` (its process stopped it before any finished) |
  `interrupted` (heartbeat lost). All but `generating` are final; `cancelled`
  and `interrupted` are retryable. `admit` decides a start from whether one
  runs and the latest of the same trigger: each trigger has its own window
  (onboarding once, nightly `NIGHTLY_EVERY`, manual `REGENERATE_EVERY`).
- Session (`session.rs`): its turn ends `finished` | `failed` (a failed turn,
  or waiting on a permission or question nobody will answer) | `timed_out` |
  `delivery_unknown` | `cancelled` | `interrupted`, stored as it leaves `open`;
  cleanup goes `open` → `stopping` → `deleted` | `abandoned`, a failed delete
  staying `stopping` for the sweep. Only `open` takes tools; `open` and
  `stopping` keep the narrow scope. What a session did is named by kind:
  `Work::FeedChanges` or `Work::RoutinesSuggested`.
- Nightly (`nightly.rs`): `decide` maps a due person to start, wait (no room:
  the tick stops), miss (night over), drop (inactive or unpaid: `next_run_at`
  cleared until seen again) or retry (plan unreadable: `NIGHTLY_RETRY`).
  `NightlyOutcome` is what the row keeps.
- Routines cadence (`cadence.rs`): onboarding always; otherwise when no
  routines session counted in `ROUTINES_EVERY`. Only one that finished and
  suggested something counts.

## Start here

- `src/domain/service.rs`: starting, running and sweeping generations.
- `src/domain/{generation,session,nightly,cadence}.rs`: the tables.
- `src/outbound/pg_generation_repo.rs`: the tables, and the adapter for the
  suggestions and routine suggestion crates' `GenerationSessions` and
  `GenerationStatuses` ports; `src/domain/audience.rs` is suggestions'
  `SuggestionAudience`.

## Scope

- Owns: `suggestion_generation`, `suggestion_generation_session`,
  `suggestion_audience`.
- Not here: what sessions may write and the change log → `crates/suggestions`,
  `crates/scheduled_action`. Session runtime → `agent_session`, which stays
  feature-neutral.

## Checks

- `cargo test -p suggestion_generation` (live DB, `SQLX_OFFLINE` unset). The
  DB tests check each SQL guard against its table, over every pair.

## Gotchas

- A status, cleanup state or nightly outcome named in SQL must match its
  domain table: partial-index scans spell states as literals, PK-addressed
  writes bind `sources()`. Change both, and the DB test says so if you don't.
- At onboarding a routines session that suggested nothing is retried once;
  never otherwise, where suggesting nothing is a fine answer.
- `routine_suggestions.generated`/`.surface` logs feed a Datadog dashboard;
  `RoutineSuggestionApi::record` emits them after the routines sessions. Its
  `kept` field is what the routines sessions suggested.
