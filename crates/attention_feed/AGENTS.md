# attention_feed

## What it is

The shared layer under Macro's attention feeds: Home's work feed
(`crates/work_feed`) and the notifications inbox. It pages authorized, hydrated
candidates with their notifications, completes, reads and restores them, and
batches realtime changes into recomputes. Each feed keeps its own model on top.

## How it works

A feed builds a `CandidateRequest` (viewer, keying, own work, types, membership
filter) and hands `FeedReader::page` a closure that turns each `Loaded`
candidate into its own entry or drops it; the reader refills from later
candidate pages. Done turns entries into `Acknowledgment`s for `Acknowledger`,
whose `DoneReceipt` is the undo token. Subscriptions run `FeedTriggers` through
`live::coalesce` and recompute with `FeedReader::current`.

## Start here

- `src/domain/models.rs`: keys, revisions, cursors, receipts, candidates.
- `src/domain/reader.rs`: paging with refill, recompute by key.
- `src/domain/keying.rs`: which candidate a notification belongs to.
- `src/outbound/soup.rs`: the candidate source over Soup's attention query.

## Scope

- Owns: candidate paging and refill, notification loading per keying, done,
  seen and undo, inbox email archive on done, live trigger batching, viewer
  team lookup.
- Not here: items, stacks and primary reasons → `crates/work_feed`;
  candidate SQL, access gates and hydration → `crates/soup` (`attention.rs`);
  notification storage → `crates/notification`.

## Boundaries

- Depends on: `notification`, `entity_access` (ports; `inbound` feature);
  `soup`, `email`, `activity`, `soup_realtime` (feature `outbound`).
- Used by: `work_feed`, `graphql_work_feed`, `document_storage_service`
  (composition), `complete_graph` (tests).

## Recipes

- Change how notifications key to candidates: `src/domain/keying.rs` and the
  matching `thread_keyed` SQL in `crates/soup/src/outbound/pg_soup_repo/attention.rs`,
  with tests on both sides.

## Checks

- `cargo test -p attention_feed --all-features`
- Feeds' tests use `test_support` (feature `test-utils`) for fixtures and fakes.

## Gotchas

- Revision, cursor and undo token JSON is a wire format clients hold across
  deploys; `models/test.rs` pins it.
- Under `ThreadScoped`, a `channel_message` candidate reads its channel's
  notifications; the feed scopes them to the thread.

## Related

- Rules: `.agents/rules/rust/architecture.md` · Docs: `docs/guides/add-notification-kind.md`
