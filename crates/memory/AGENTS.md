# memory

## What it is

Owns composed AI memory: private explicit preferences, privacy-reviewed professional
profiles, and daily activity rolled into calendar weeks, months, and a long-term
summary. Legacy `memory` rows remain private and are not copied into shared profiles.

## Start here

- `src/domain/service.rs`: composition, explicit edits, current-team access, daily
  generation and sequential catch-up. `models.rs` owns line edits and UTC periods.
- `src/domain/ports.rs`: storage, generation and current membership contracts.
- `src/outbound/pg_composed_memory.rs`: component storage and generation leases.
- `src/outbound/generator.rs`: generic agent research and summaries on Sonnet 5.5 at
  medium effort.
- `src/outbound/jev_judge.rs`: the privacy judge. One Jev call per piece asks one
  yes/no question per privacy rule (`Rule`); each rule has its own threshold.
  Explicit memory is held only to the sensitive-information rules.
- `src/inbound/toolset.rs`: ReadMemory, UpdateMemory, GetUserActivity.
- `src/inbound/axum_router.rs`: `GET /memory` (composed), `GET`/`PATCH
  /memory/explicit` and `GET /memory/activity`, the SDK's equivalents of the tools.
- `src/schedule.rs`: tracked internal cron closure hosted by cognition in nonlocal
  environments; retries due users every five minutes, generating completed days.
  The PostHog flag `disable-memory-refresh` (service context `memory-refresh`)
  is read before each claim and stops the batch while it is on; a failed flag read
  keeps refresh running.
- `../ai_tools/src/memory.rs`: composition root, allowlisted read-only research, and
  the activity-log adapter behind `MemoryActivity`.
- `../ai_tools/src/bin/memory.rs`: awaited one-user CLI (`cargo run -p ai_tools
  --bin memory`); uses the existing memory environment configuration.

## Boundaries

Business policy and authorization live in the domain service. SQL and model calls
are outbound adapters. `ai_tools` depends on this crate; this crate must not depend
on `ai_tools`. Runtime context is composed with `prompt::compose`.

Explicit edits require a current revision, use one-based lines, and are never
performed by generation. Deletion remains possible if older content would fail
privacy review. A person's own read (`MemoryReader::Person`: the HTTP routes
for an unattributed request, a cognition chat message, an agent turn streamed
to someone watching) enrolls them for daily generation but never launches
it; a program's read (`MemoryReader::Program`: code mode, routines, scoped
runs, tool calls, unwatched or mention turns) only reads.
Current memberships determine shared profile and activity access on every request.

Daily reports are immutable. Weekly/monthly reports rebuild from daily reports
(whole weeks plus uncovered days for months); only the summary uses its prior
version. UTC weeks start Monday. A 25-minute database lease bounds concurrent
workers; each generation has a 20-minute timeout. Profile revisions guard the
atomic component commit. Days commit in order: a failed day is retried after a
growing delay and given up after `MAX_REFRESH_ATTEMPTS` claims, committing the
pieces that passed review (kept in `memory_refresh_piece` between attempts). A day
with no activity in the activity log (`MemoryActivity`) commits without model calls.

## Checks

- `cargo test -p memory` with SQLX_OFFLINE unset and a migrated local database.
- Judge questions or thresholds: run the live evaluation with `TYPESAFE_API_KEY`
  set, `cargo test -p memory --lib jev_judge::eval -- --ignored --nocapture`.
- After SQL changes: `nix develop --command just prepare_db` at repository root.
- Tool changes: regenerate schemas with `bun gen-tools` in `apps/web`.

## Gotchas

- The judge fails closed: a host without `TYPESAFE_API_KEY`, or a failed Jev
  call, saves no memory (`ReviewUnavailable`, 503 over HTTP).

## Related

- [Composed memory](../../docs/architecture/composed-memory.md)
- `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`
