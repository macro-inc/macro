# suggestion_generation

## What it is

Generations for Ideas and routine suggestions: runs of hidden agent sessions,
at onboarding and in each person's night, that write their ideas
(`crates/ideas`) and routine suggestions (`crates/scheduled_action`) through
those crates' tools. Hosted by the harness's scheduling runtime.

## How it works

- `POST /scheduled-action/suggestions/generate?timezone=` (onboarding, once the
  inbox connects) or the nightly tick (`GenerationService::nightly`, every five
  minutes in the harness) starts a generation: one `suggestion_generation` row,
  then one ideas session and routines sessions at once (at onboarding one per
  `SessionLayout` group, for speed; at night one for every surface, for cost),
  each kind only when its flag is on (`enable-suggestions`,
  `enable-routine-suggestions`).
- Each session is hidden, the person's, non-billable, and may call its kind's
  tools while its `suggestion_generation_session` row is open. Its brief comes
  from the kind's crate (`IdeaApi::brief`, `RoutineSuggestionApi::brief`).
- Code here only schedules, waits, cleans up and logs. The sessions do all
  judging through the tools; no reconciliation, ranking or retiring here.
- Nightly: people on a paid plan (`Plans`, from AI billing's entitlements)
  seen in the last week (`suggestion_audience`: an app load with ideas on,
  `POST /scheduled-action/suggestions/seen?timezone=` from the web app, the onboarding start, and ideas feed
  reads with a time zone, the last through `audience::PaidAudience`). Each
  row stores `next_run_at`, a time of the person's own inside 2 to 5 am in
  their zone (`night.rs`); the tick reads only who is due, longest waiting
  first, keeps reading while people are dropped (unpaid, inactive) or passed
  over (their night ended: moved to the next one), and moves each person it
  starts to their next night. At most `MAX_NIGHTLY_RUNS` per process; the
  `suggestion.nightly_short` warning counts people due but not started. A
  nightly run includes the routines
  session once a week (`ROUTINES_EVERY`); other nights only the ideas session
  runs. Onboarding runs for every plan. A run its process never finished (a deploy
  cancels runs in flight) counts as going only until `STALE_GENERATION`; then
  it reads as failed and holds no nightly cooldown, the same trigger restarts it
  in place, and the other records it failed.
- Generation sessions are scoped where their code-mode credential is minted
  (`agent_correlation::scope::SessionScope::Generation`, decided by the
  harness's `SessionScopes`): every service refuses their requests other
  than reads, their own tools and email drafts, and the native tool gate
  their non-code tools. A new session tool route goes on the scope's list.
- Traces: an onboarding generation is a child of the request that started
  it; a nightly one is its own root span linked to the tick. Its trace id is
  kept on `suggestion_generation.trace_id` and recorded as
  `suggestion.generation.trace_id` on every session tool call (they reach
  the API without the trace's context). `user.id` is the person's opaque
  account id. The sweep deletes change-log entries older than
  `CHANGES_KEPT` (90 days), a batch at a time.
- `POST /scheduled-action/scheduled-actions/suggestions/generate` is the
  retired onboarding route, kept for old web and app bundles: it starts
  onboarding and answers with routine suggestions. It is not in the spec;
  remove it once no bundle calls it.

## Start here

- `src/domain/service.rs`: starting, running and sweeping generations.
- `src/outbound/pg_generation_repo.rs`: the tables, and the adapter for the
  ideas and routine suggestion crates' `GenerationSessions` and
  `GenerationStatuses` ports; `src/domain/audience.rs` is ideas'
  `SuggestionAudience`.

## Scope

- Owns: `suggestion_generation`, `suggestion_generation_session`,
  `suggestion_audience`.
- Not here: what sessions may write and the change log → `crates/ideas`,
  `crates/scheduled_action`. Session runtime → `agent_session`, which stays
  feature-neutral.

## Checks

- `cargo test -p suggestion_generation` (live DB, `SQLX_OFFLINE` unset).

## Gotchas

- At onboarding a routines session that kept nothing is retried once; never
  nightly, where keeping nothing is a fine answer.
- `routine_suggestions.generated`/`.surface` logs feed a Datadog dashboard;
  `RoutineSuggestionApi::record` emits them after the routines sessions.
