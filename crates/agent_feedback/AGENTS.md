# agent_feedback

## What it is

Agent response feedback: thumbs up or down plus an optional note on an agent
session's reply turn, an agent's message (channel, DM, thread, discussion) or a
routine run, for internal evals, behind the `enable-agent-response-feedback`
PostHog flag. Served by `agent_harness_service` under `/agent-feedback` and
`/internal/agent-feedback/events`. Reading the data: [README](README.md).

## How it works

- Handlers mint the container's view receipt the way its own read routes do:
  `AgentSessionAccessLevelExtractor` (session), `principal_entity_access_receipt`
  over `MessageParent::access_entity_type` (message parent),
  `ScheduledActionAccessExtractor` (routine, path `{id}`). Callers are
  `UserOnly`; the rater is the receipt's authenticated user.
- `FeedbackService` (`src/domain/service.rs`) checks the receipt is for the
  route's container, the flag (off: `NotFound`, 404, before any read or write;
  answers cached 60 s per person), the note (≤ 4000 chars, blank is none), then
  reads the context: a message through `MessageReader::get` (not in the parent:
  422 `subject_not_in_container`; not a bot or `"User"."isAgent"` sender: 422
  `not_agent_authored`) and its leading `<m-agent-session-mention>`; a run
  through `RoutineRuns`; model and harness through `AgentSessions`.
- `PgFeedbackRepo::append_if_changed` holds a transaction advisory lock per
  (person, response): a known id is a replay (or 409 `id_taken` for another
  response), a write equal to the newest row writes nothing, otherwise it
  appends with `clock_timestamp()`.

## Scope

- Owns: `agent_response_feedback` and its enums, the feedback routes and spans
  (`agent_feedback.rate|retract|mine|export|flag`).
- Not here: the session and routine adapters (`SessionRepoFacts`,
  `RoutineRunRecords`) live in `services/agent_harness_service/src/agent_feedback.rs`
  over `agent_session` and `scheduled_action` ports; the web UI is in
  `apps/web` (feature `agent-feedback`).

## Checks

- `cargo test -p agent_feedback` (`SQLX_OFFLINE` unset; Postgres tests use
  `MACRO_DB_MIGRATIONS`).
- After an API change: `bun run --cwd apps/web gen-api agent-harness`, then
  `bun run sync-specs && bun run generate && just coverage` in `packages/sdk`
  (the routes are in `agentHarnessExcluded`).

## Gotchas

- Never record the note, message content or the rater's user id on a span.
- Rows outlive the rated session, message or run on purpose (eval history) and
  cascade only with the rater's `"User"` row.
- The client mints the row id (UUIDv7) per action and resends it on retry; a
  new action needs a new id.
- `mine` lists only the caller's newest unretracted rows; `turn` is set only for
  `agent_session_turn`, and `subjectId` is the session, message or run id.

## Related

- Rules: `.agents/rules/observability.md`, `.agents/rules/rust/db.md` · Skills:
  `feature-flags`, `add-sdk-endpoint`
