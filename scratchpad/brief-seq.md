Build the server change sequence for channel messages: every committed change to a channel's messages takes the next number in that channel's sequence inside the same transaction, a "changes after N" domain read returns what a client missed, old rows are pruned, and the existing realtime pushes carry the number. This is the first PR of the "full local sync" channels stack (the device cache indexes channel messages and catches up by sequence instead of refetching pages). You build the branch; `channels-local-sync` reviews it, opens the PR and runs the stack-level proofs.

## The user's words

"The goal of this is to get channels working in the cache and always have them fast to open. While maintaing feature parity on going to location etc... We need to make sure channel loading is extremely efficient and that channels never get out of date."

Standing preferences: new features copy existing patterns, they don't add new mechanisms. A change to production-critical code ships with proof of no regressions, old against new. No feature flags.

## Settled decisions

Ask `channels-local-sync` before changing any of these.

- The contract in `/tmp/claude-1001/-home-teo--herdr-worktrees-macro-synoet-channels-local-sync/5c052d5a-35e5-475f-8f8a-ea1c0034b3ce/scratchpad/contract.md`, section 1 (tables, kinds, rules, push fields) is binding. Section 2 (GraphQL) is another helper's; you supply the domain read it calls.
- A per-channel counter on the message write transaction is accepted, gated on proof that write latency and concurrent posting do not regress. The message store is shared with doc comments and agents: non-channel parents must run exactly the statements they run today.
- Pushes keep the existing connection-gateway `message_update` and `timeline_activity` events, with `seq` added. No GraphQL subscription.
- Copy the calendar change log: `crates/calendar_events/src/domain/changes.rs`, its Postgres adapter and prune job, and migration `crates/macro_db_client/migrations/20261006230258_calendar_change_log.sql`.

## What to build

1. Migration (via `sqlx migrate add`, see the `sqlx-migration` skill): the two tables in the contract.
2. `crates/messages/src/outbound/pg_message_repo.rs`: `create`, `edit`, `delete`, `react`, `patch_thread`/`delete_thread` (`set_thread_in`) append the log row for channel parents and return the sequence they took. Thread the sequence to `MessageEvent` as `seq: Option<i64>` (serialized only when present) so `message_update` carries it. `MessageRepository` has two test fakes in `crates/messages/src/domain/service/test.rs`.
3. Historical import (`insert_historical`, `crates/messages/src/outbound/pg_message_repo/historical.rs`) logs one `reset` row per touched channel per batch, in its transaction.
4. System rows: activity recorded for a channel that `CHANNEL_TIMELINE` shows (`crates/messages/src/domain/ports.rs`, `timeline_parent`) reaches the log at least once (see the contract), and `timeline_activity` (`services/document_storage_service/src/service/activity/timeline.rs`) carries each activity's `seq`. Keep crate ownership rules (CS-27, CS-51 to CS-53 in `.agents/rules/rust/architecture.md`): the activity crate must not learn about channels. Say in your report which guarantee you achieved and how.
5. Call roots: a channel call ending, or its record being deleted, logs a `message` row for the call root (find where `call_entities` rows end or are deleted; `call_entry_statuses` in the repo reads them).
6. Domain read in `crates/messages` (port + service + `MessageServiceApi`): `channel_changes(access, channel_id, after) -> ChannelChanges { reset_required, seq, has_more, messages (current state: roots as `MessageListItem`, replies as `Message`, a changed reply listed with its root), activities (`TimelineActivity`), removed_ids }` and `channel_seq(channel_id) -> i64` (the counter, 0 when none). Limits as in the contract (200 log rows a page, more than 1000 behind or below the floor or a `reset` row = `reset_required`). Authorization identical to the existing timeline read.
7. Retention job: prune rows older than 30 days in batches, wired where the calendar prune job is wired.
8. Spans on the new read and the prune job (`.agents/rules/observability.md`).

## Proof to produce (commit the tests; put numbers in your report)

- A concurrent-writer DB test: N tasks posting, editing and reacting in one channel; the log's `seq` order equals commit order (each writer's returned `seq` is unique, gap-free 1..=N, and a reader that sees seq K also sees every message change below K).
- Write latency old against new on the same database: time `create`, `edit`, `react`, `delete` at the repository level before and after (median and p95 over at least 2,000 writes each, 1 writer and 16 concurrent writers in one channel, and 16 writers across 16 channels). Report the table. A `cargo` example or ignored test that prints it is fine; say how to rerun it.
- Document-parent writes execute no new statement (a test, or statement counts).
- `EXPLAIN (ANALYZE, BUFFERS)` for the changes-after-N read and the prune query on a log with at least 1,000,000 rows (seed a local test database; do not touch the `channels` stack instance on Postgres port 22900 except to read).
- `cargo test -p messages --all-features` and the tests of every crate you touched, with `SQLX_OFFLINE` unset; `just prepare_db` output committed; `just check` clean.

## Where to start

- `CLAUDE.md`, `CODING.md`, `crates/messages/AGENTS.md`, `docs/development/database.md`, the `query-writing` and `sqlx-migration` skills.
- `~/.fleet/areas/channels.md` for the investigation's findings (verified at main `0e81244ed0`).

## Done means

Your branch holds small logical commits (Conventional Commit titles, `git` skill) with everything above, tests passing locally, not pushed and no PR. Post `done` with: the branch and head commit, the latency table, the test names, the guarantee for system rows, and anything in the contract you could not meet. If something in the contract is wrong or impossible, post `ask` with your pick and carry on with the rest.

## Limits

- Use only your own account; if it runs out, stop and post `blocked`.
- Do not start, stop, rebuild or reseed the local stack instance `channels`.
