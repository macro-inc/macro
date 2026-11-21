# attention_feed

## What it is

The shared layer under Macro's attention feeds: Home's work feed
(`crates/work_feed`) and the notifications inbox (`crates/notification_inbox`). It pages authorized, hydrated
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
- `src/outbound/soup.rs`: the candidate source over Soup's attention query,
  and the keys that may hold something unread (`unread_keys`), which a feed
  reads through `FeedReader::current` before trusting one.

## Scope

- Owns: candidate paging and refill, notification loading per keying, done,
  seen and undo, inbox email archive on done, live trigger batching, viewer
  team lookup.
- Not here: items, stacks and primary reasons → `crates/work_feed`; inbox
  rows → `crates/notification_inbox`;
  candidate SQL, access gates and hydration → `crates/soup` (`attention.rs`);
  notification storage → `crates/notification`.

## Boundaries

- Depends on: `notification`, `entity_access` (ports; `inbound` feature);
  `soup`, `email`, `activity`, `soup_realtime` (feature `outbound`).
- Used by: `work_feed`, `notification_inbox` and their GraphQL adapters,
  `document_storage_service` (composition), `complete_graph` (tests).

## Recipes

- Change how notifications key to candidates: `src/domain/keying.rs` and the
  matching `thread_keyed` SQL in `crates/soup/src/outbound/pg_soup_repo/attention.rs`,
  with tests on both sides.

## Checks

- `cargo test -p attention_feed --all-features`
- Feeds' tests use `test_support` (feature `test-utils`) for fixtures and fakes.

## Gotchas

- `reader::listed` asks a candidate source how a new notification about one
  entity would be listed (Soup's `assume_attention` probe), returning the
  hydrated entity or `None`; the inbox wraps it as
  `new_notification_listing` and the work feed as `admits_new_notification`,
  each with its own candidate request.

- `CandidateRequest::read` picks the store. Pages and pre-write checks read
  the replica (`CandidateRead::Replica`); the feeds' recomputes (live updates,
  and the entries undo, seen and the inbox's single-notification done return)
  read the primary (`Committed`, through
  `SoupCandidateSource::with_committed_reads`). Clients apply recomputed
  entries over the Soup patch that announced the change, which was hydrated
  from the primary, so entries read from a lagging replica would write the
  state before the change back into their caches. `outbound/soup/test.rs`
  pins the routing with a store per read (`AttentionPages`, `ViewerInboxes`).
- Revision, cursor and undo token JSON is a wire format clients hold across
  deploys; `models/test.rs` pins it.
- Undo recomputes every key its token names, on the primary, so the GraphQL
  undos decode with `DoneReceipt::decode_at_most` and their done mutation's
  item limit; a token naming more keys is refused before anything is written.
- Under `ThreadScoped`, a `channel_message` candidate reads its channel's
  notifications; the feed scopes them to the thread.

## Related

- Rules: `.agents/rules/rust/architecture.md` · Docs: `docs/guides/add-notification-kind.md`
