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
- `src/outbound/generator.rs`: generic agent research and tool-free privacy judge.
- `src/inbound/toolset.rs`: ReadMemory, UpdateMemory, GetUserActivity.
- `src/schedule.rs`: tracked internal cron closure hosted by cognition in nonlocal
  environments; retries due users every five minutes, generating completed days.
- `../ai_tools/src/memory.rs`: composition root and allowlisted read-only research.
- `../ai_tools/src/bin/memory.rs`: awaited one-user CLI (`cargo run -p ai_tools
  --bin memory`); uses the existing memory environment configuration.

## Boundaries

Business policy and authorization live in the domain service. SQL and model calls
are outbound adapters. `ai_tools` depends on this crate; this crate must not depend
on `ai_tools`. Runtime context is composed with `prompt::compose`.

Explicit edits require a current revision, use one-based lines, and are never
performed by generation. Deletion remains possible if older content would fail
privacy review. Reads enroll a user for daily generation but never launch it.
Current memberships determine shared profile and activity access on every request.

Daily reports are immutable. Weekly/monthly reports rebuild from daily reports
(whole weeks plus uncovered days for months); only the summary uses its prior
version. UTC weeks start Monday. A 25-minute database lease bounds concurrent
workers; each generation has a 20-minute timeout. Profile revisions guard the
atomic component commit. Failed days must complete before later days.

## Checks

- `cargo test -p memory` with SQLX_OFFLINE unset and a migrated local database.
- After SQL changes: `nix develop --command just prepare_db` at repository root.
- Tool changes: regenerate schemas with `bun gen-tools` in `apps/web`.

## Related

- [Composed memory](../../docs/architecture/composed-memory.md)
- `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`
