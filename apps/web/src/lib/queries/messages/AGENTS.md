# queries/messages

## What it is

Server state for messages on any parent (channel, document, project, call):
the paged timeline, thread replies, sends, edits, reactions, typing, and the
live events that keep them current.

## Start here

- `timeline.ts`: the infinite timeline query and every operation on its pages.
- `sync.ts`: live `message_update` events applied to loaded pages.
- `mutations.ts`, `reactions.ts`: optimistic writes (REST).
- `graphql/`: how a channel's timeline reads through the device cache.
  - `source.ts`: the GraphQL reads and the cached latest page.
  - `channel-sync.ts`: opening from the cache, catch-up, writing the page back.
  - `apply.ts`: changes applied to loaded pages; `convert.ts`: GraphQL ↔ timeline shapes.
  - `prewarm.ts`: warming the pages of channels not open yet, and evicting
    the pages of channels not opened for 30 days.

## Scope

- Owns: message queries, their keys, and the channel read path.
- Not here: channel lists and unread state → `../channel`; the cache engine →
  `lib/graphql-cache`; message views → `features/channel`.

## Checks

- `bunx vitest run src/lib/queries/messages` from `apps/web`.

## Gotchas

- The TanStack timeline is the working state for every parent. For a channel
  with the device cache on (`channelCacheHost()`), only its source changes;
  optimistic writes and live events still edit the same pages. Tests of the
  REST reads mock `channelCacheHost` to `undefined`.
- The cache keeps one page per channel: the latest, at most 100 rows, with the
  change sequence number it is current to. Pages behind a cursor or around a
  message are read from the server and never cached.
- A channel opens from that page, then asks `changes(since: seq)` and applies
  the rows: changed roots replace or join the loaded pages, removed ids leave
  them, replies go to loaded threads. A `reset`, more than 20 change pages, or
  a failed read invalidates the timeline, which then reads the server's page.
  Rows read again are in doubt, so they give up their number first
  (`readAgain`): without one the timeline is not caught up or written back
  until the server's page brings a new one.
- The sequence number lives on the loaded latest page (`channel_seq` on page
  0), never beside it. A refetch that commits, a cancelled one that reverts,
  and a rollback that restores a snapshot move the rows and the number
  together; a number kept elsewhere ends up claiming rows that are gone.
- Changes apply only when that number is still the one the request was made
  with; otherwise the catch-up asks again from where the timeline is now.
  After applying rows it restarts a page read still in flight, which would
  commit its older snapshot over them. Changed roots also replace the root
  and state of a loaded thread.
- The page is written back about a second after a server read, a catch-up or
  a pushed change,
  never as part of the read that shows it, and only when
  the first loaded page is the live edge, the cache is still the session's,
  and no message write for the channel is pending, so an optimistic row is
  never stored.
- A timeline already loaded is never replaced from the cache: a refetch reads
  the server.
- The open waits on the cache alone (for 2 s) only for a channel it is known
  to hold a page for, learned from this session's reads and writes
  (`noteCachedPage`). Any other channel is most likely a miss or the cache is
  still starting, so the open asks the server at once and shows whichever
  answers first. A cached page that wins
  stops waiting for the server read; one that arrives after the server could
  not be reached is shown too, so a channel opens offline. A refusal from the
  server (not a member, not found) is its answer and is never covered by the
  cached page: the cached page is emptied, and a refused catch-up or a refused
  re-read of a loaded timeline also drops the loaded rows so the read that
  follows shows the refusal.
- A catch-up stops when the timeline is already at the number the server
  answered with, runs once more for a request made while it was finishing,
  and treats a changes read with no answer in 15 s as failed. A reply for a
  thread whose first read is in flight makes that thread read once more
  when the read lands; the reply itself may be older than what it returns.
- The messages client sends a write again, twice a second apart, when the
  server answers 503 (its write guard); the id and nonce stay the same, so
  the retry cannot post twice. A refused edit, delete, reaction or thread
  change is not sent again once a later write to the same message has
  started: it fails as refused instead of landing after the later one.
  Reads are not retried.
- A channel read this way is tracked: `handleMessageEvent` compares a pushed
  change's `seq` with the timeline's. The next number applies and moves it (the
  sender's own echo too: the number must describe rows the timeline holds),
  a lower one is dropped, and a higher one
  starts a catch-up without applying, as does any change the loaded pages
  cannot take exactly (a deleted reply they do not hold, a call row). Timeline
  facts are pushed without a number, so the change after one catches up.
- A tracked timeline is never marked stale (`softInvalidateMessageTimeline`
  returns early) and a reopened subscription catches up instead of
  invalidating. Don't add an invalidation for a channel change: route it to
  `catchUpTrackedChannel` and fall back to invalidating when it returns false.
- A failed message or reaction write on a tracked channel reads the
  timeline again (`reconcileFailedChannelWrite`): the server may have
  committed it and its echo may already have moved the number past it.
  The next optimistic write cancels that read, so a check every second
  asks for it again once no write is pending, until the number is back (a
  read the server failed is left to a reconnect or the next open). The
  sender's own pushed change arriving meanwhile starts that read over: a
  read from before the write would commit a number that keeps the write's
  response out.
- A write's response is applied only while the timeline's number is the one
  the write started at (`channelWriteResponseApplies`). After it has moved,
  the response may predate rows the timeline holds, and an older row under
  a newer number is never corrected; the write's own change comes by its
  number instead.
- Writing a page deletes the rows the stored page held and the new one drops
  (`writeCachedLatestPage`), so a channel keeps at most one page of rows. A
  tab runs a channel's writes one at a time. The rows are found through the
  page record (`ChannelCachedPageRows`), not the viewer; a page missing a row
  (left by writers in two windows racing) reads as a miss, so its rows can't
  be found and stay until written over. The engine keeps the viewer's links
  to the 1024 most recently written channel pages (`cache-core`
  `page_retention.rs`); a page whose link it dropped reads as a miss, and its
  records stay until the next write or eviction deletes them.
- While the tab is visible and idle, the unread channels and the 20 most
  recently opened are warmed three at a time (`useChannelCachePrewarm`,
  mounted with the navigation unread state): no page reads the latest; a
  cached page catches up from its number like an open and is written back.
  A channel whose timeline is in TanStack Query is never touched, and a
  timeline read in flight goes first. A channel is warmed once per session,
  again when it turns unread again.
- "Last opened" is the later `viewed_at` of the channel list and the activity
  list (which opening a channel moves). In each page load, once both lists
  have been read from the server (lists restored from the device can be a
  week old), and then at most once a day, the pages of channels in those
  lists not opened for 30 days and not about to be warmed are deleted with
  their rows. Without both lists every page would look stale.
- Threads, `messagesByIds` and message resolution still read REST.
