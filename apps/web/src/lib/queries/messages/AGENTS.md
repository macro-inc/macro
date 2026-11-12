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
- Threads, `messagesByIds` and message resolution still read REST.
