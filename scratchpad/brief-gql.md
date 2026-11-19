Build the GraphQL reads for channel messages: the channel timeline (latest, older, newer, around a message), paged thread replies, a single message, and changes after a sequence number, all answering exactly what the REST endpoints answer today. This is the second PR of the "full local sync" channels stack (the device cache will index channel messages and answer timeline queries itself; these reads feed it). You build the branch; `channels-local-sync` reviews it, opens the PR and runs the stack-level proofs.

## The user's words

"I want to kick off a fable 5.2 session to start working on porting channels to using gql. The goal of this is to get channels working in the cache and always have them fast to open. While maintaing feature parity on going to location etc... We need to make sure channel loading is extremely efficient and that channels never get out of date."

Standing preferences: lists are filtered on the server. New features copy existing patterns, they don't add new mechanisms. A change to production-critical code ships with proof of no regressions, old against new. No feature flags.

## Settled decisions

Ask `channels-local-sync` before changing any of these.

- The contract in `/tmp/claude-1001/-home-teo--herdr-worktrees-macro-synoet-channels-local-sync/5c052d5a-35e5-475f-8f8a-ea1c0034b3ce/scratchpad/contract.md`, section 2, is binding: type names, field names, nullability, `sortKey` format, cursor meaning, `seq` read before the page.
- Reads use the primary database, as REST does.
- A separate type `GraphqlChannelMessage`; do not extend `GraphqlSoupChannelMessage`.
- The change sequence (section 1 of the contract) is built by another helper, `channels-local-sync-seq`, on branch `synoet/channels-local-sync-seq`. `channelChanges` and the pages' `seq` call its domain read (`channel_changes`, `channel_seq` on the messages service). Build everything else first; `channels-local-sync` will tell you when that branch is ready to rebase onto. Until then return `seq: "0"` behind one clearly marked seam.

## What to build

1. In `crates/graphql_channel`: the types and the four user-scoped fields in the contract, flattened onto `GraphqlUser` in `crates/complete_graph/src/schema.rs` the way calendar's are (`crates/graphql_calendar/src/user_query.rs` is the model; `docs/guides/add-graphql-field.md` is the checklist, follow all of it: context struct in request data, wiring in `document_storage_service`, regenerated `static_assets/schema.graphql`, composed-schema tests, SDL assertions).
2. The resolvers call the existing messages domain service (`crates/messages/src/domain/api.rs`, the same calls the REST handlers in `crates/messages/src/inbound/axum_router.rs` make) so authorization and results are identical. Paged thread replies need a new bounded domain read and repository query (REST returns the whole thread); keep the REST endpoint as it is.
3. Fix the scroll-back query: `older`/`newer` in `crates/messages/src/outbound/pg_message_repo/timeline.rs` do not use their index for the `(created_at, id)` cursor, so paging gets slower with depth (9 ms of SQL at 32,000 messages back on the 50,000-message seeded channel). Make the keyset index-backed without changing results. The REST endpoint benefits too.
4. Spans on the new reads (`.agents/rules/observability.md`; calendar's resolvers show the form).
5. Web documents are not yours; do not touch `apps/web`.

## Proof to produce (commit the tests; put numbers in your report)

- Row-for-row equality with REST: a test (DB-backed, through the composed schema and the REST handler or the shared domain call) that, on a channel with roots, replies, tombstones, a deleted thread, reactions, attachments, mentions, a bot message, imported replies with `import_order`, activity rows and a call root, walks latest, every older page, newer pages from the oldest, and around windows (root target, reply target, first and last message), and asserts the same entries in the same order with the same field values and the same has-more answers. Same for threads: all thread pages concatenated equal REST's thread.
- `sortKey` order equals server order (a property over the same fixture).
- `EXPLAIN (ANALYZE, BUFFERS)` before and after for `older` and `newer` at depth on a 50,000-message channel, and for the new thread page query on a 250-reply thread. The local stack instance `channels` (Postgres `localhost:22900`, seeded channels perf-small/medium/large of 50 / 2,000 / 50,000 messages) is main's schema with that data: you may read from it and run EXPLAIN on SELECTs there, nothing else.
- Server time of a latest page through GraphQL not worse than REST's on the same data (say how you measured).
- `cargo test` for every crate you touched with `SQLX_OFFLINE` unset; `just prepare_db` output committed; `just check` clean; SDL regenerated.

## Where to start

- `CLAUDE.md`, `CODING.md`, `docs/guides/add-graphql-field.md`, `crates/complete_graph/AGENTS.md`, `crates/messages/AGENTS.md`, the `query-writing` skill.
- `~/.fleet/areas/channels.md` for the investigation's findings (verified at main `0e81244ed0`).

## Done means

Your branch holds small logical commits (Conventional Commit titles, `git` skill) with everything above, tests passing locally, not pushed and no PR. Post `status` when the timeline, thread and single-message reads are complete (before `channelChanges`), and `done` at the end with: the branch and head commit, the equality test names, the before/after plans and timings, and anything in the contract you could not meet. If something in the contract is wrong or impossible, post `ask` with your pick and carry on with the rest.

## Limits

- Use only your own account; if it runs out, stop and post `blocked`.
- Do not start, stop, rebuild or reseed the local stack instance `channels`.
