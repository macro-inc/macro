# Channel local sync (web client)

## What it is

The channels client for devices that keep channels in the GraphQL cache engine
(`enable-channel-local-sync`). A channel's timeline, threads and writes read
from and go through the device; the server fills what the device lacks and the
`channelTimelineUpdates` subscription keeps it current. With the flag off, on a
host without the channel commands, and for non-channel parents, the REST and
TanStack path in `../` runs untouched. A host whose database is away for now
(`paused`) stays the channels' host: never read or write around its queue.

## Who decides what

The engine decides what is stored. Every answer carries a `seq`, a floor: its
records are at least that new. The engine stamps each record with it, keeps a
tombstone for what was removed, and stores a response's records, coverage and
watermark in one transaction, so answers may arrive in any order and from any
tab. This code never repairs the device, orders acknowledgements, or locks tabs
out of each other. It decides only when to ask the server, and what a view shows.

| Answer | Commit (`ChannelCommitArgs`) |
| --- | --- |
| Timeline or thread page | `watermark: lower`, the coverage it proves |
| `channelChanges` page | `watermark: advance` from the cursor asked, `removedIds` |
| Pushed frame | `watermark: advance`, `removedIds` |
| Too far behind (`resetRequired`) | the latest page with `reset: true` |
| Mutation, `channelMessage` | none: the stamp alone |

A query passes its commit as urql's `channelCommit` context
(`queryChannelNetwork`); the outcome is `applied`, `stale`, `gap` or `unheld`,
with the watermark after it.

## How it works

- Read: `channel-pages.ts` asks the host for a page (`channelTimeline`). A
  covered page is read by key (`readRecordsByKeys`); a miss fetches
  `ChannelTimeline`. Threads do the same per root (`channel-thread.ts`,
  `ChannelThread`, coverage with `threadRootId`).
- Follow: one runtime per host (`channel-sync-runtime.ts`). A channel is
  current while the socket is connected and the device's watermark has reached
  both the newest sequence the server said it was at and the newest frame since
  the socket connected. Only the device says where its watermark is: the
  runtime reads it (one local request) after every change of a channel on
  screen, and never takes it from an acknowledgement or a view's read, which
  may be older than what another tab did since. Behind, a channel on screen
  catches up through `channelChanges` after a jittered debounce, one off screen
  when it is opened or prewarmed. A failed catch-up, or one that keeps ending
  behind, is tried again after a wait that doubles (`CATCH_UP_RETRY_MS` to
  `CATCH_UP_RETRY_MAX_MS`), which a frame or a reconnect cuts short. The
  server does not say when a new connection receives every change, so
  `LISTENING_MS` after it nothing heard before counts and each channel is asked
  for once more. An acknowledgement's sequence serves only as the next page's cursor
  while more pages follow; the last page, a gap and a reset read the device
  again. Take
  `epoch()` before a server read and report it with the sequence the server
  read at (`noteServerRead`): a read sent over another connection proves
  nothing. `tests/channel-sync-convergence.test.ts` runs all of it in random
  orders; change the rules only with it passing.
- Views read again when the host reports a change of the channel
  (`onChannelChanged`, every tab's, through the runtime's `onChanged`). A view's
  own store is reported to it too, so a device that keeps losing what a view
  stores is asked `SESSION_CHANGE_RELOADS` times at once, then after waits.
- Write: `channel-writes.ts` enqueues the `*ChannelMessage` mutations on the
  durable cache mutation queue and waits for their settlement. The hooks in
  `../mutations.ts` and `../reactions.ts` pick the path for each write
  (`../device-writes.ts`): one the device takes runs no TanStack mutation and
  writes no TanStack message cache (the channel lists in Soup's cache are still
  stamped), and a REST one keeps the app's defaults. A channel a
  view on screen reads over REST keeps its writes on REST (`keepChannelOnRest`),
  as does a message with an anchor; not one whose only REST view is a thread of
  more than `MAX_THREAD_PAGES` pages.
- Outage: while the host is `paused`, open channels keep what they show, new
  ones load from the server unheld, and writes wait
  (`channel.write.await_cache`). Once it serves again the session proves it
  readable: channels stay with a host that answered, or was away, before
  (`sessionChannelHost` in `channel-flag.ts`), reads and pushed frames go to
  it, and writes still wait until its queue has been read. `restartCache` in
  `graphql-soup.ts` then calls `resumed()` on its runtime and writes; an engine
  replaced over its storage without a pause resumes them too
  (`channel-sync.ts`). Once the page stops trying to prove a host
  (`recovery-required`) its writes are retired and channels go over REST until
  a reload; the stream, like Soup's, only goes on storing what is pushed.
- Ahead: `channel-prewarm.ts` fetches unread then recent channels while the
  person is idle, and evicts channels untouched for 30 days.

### How a write ends

A write goes out only through the queue (`onlyQueued`), in the order it was
asked for in its channel (`takeTurn`), under the sign-in it was asked for under.

| What happened | Send | Edit, delete, reaction |
| --- | --- | --- |
| Never reached the queue, which was there (`NOT_QUEUED`) | fails as not sent, draft restored | fails |
| Its sign-in ended before its turn, or no sign-in said who it is | `CACHE_RETIRED` | `CACHE_RETIRED` |
| The host retired, or its storage was reset, with the write in the queue | `DELIVERY_UNKNOWN` | `CACHE_RETIRED`, `CACHE_RESET` |
| The enqueue's acknowledgement was lost | still queued: its settlement; settled: device copy, then the server's (`ChannelMessage`), else `DELIVERY_UNKNOWN` | still queued: its settlement; settled: applied if the device shows it, else `NOT_APPLIED` |
| The answer was lost | the server's copy (`ChannelMessage`), else `DELIVERY_UNKNOWN` | fails |
| The server answered, the device could not store it | the server's copy | the server's copy; never rejects |

An absent server copy proves nothing while a request may still commit, so a
send is never called failed on it. The composers send a restored draft of an
uncertain send again under the same id
(`features/channel/Input/utils/uncertain-sends.ts`), in memory only and until
the session ends. Recovery runs as `channel.write.recover` in the write's
trace. A write is its transaction id and its mutation id: transaction ids
restart when the queue is rebuilt. The queue replays every write the network
lost; of those the server refused, only sends and deletes answered
`SERVICE_UNAVAILABLE` (`graphql-mutation-retry.ts`).

## Start here

- `channel-sync.ts`: the per-host factories every caller goes through.
- `../channel-timeline-source.ts`: `useChannelReadPath`, the once-per-mount
  choice between device and REST; `../thread-replies.ts` uses the same choice.
  A flag PostHog has not answered yet reads as off: REST never waits for it.
- `../device-writes.ts`: what the write hooks do with a device write (toasts,
  analytics, list bumps).

## Checks

- `bun run test -- src/lib/queries/messages` (from `apps/web`).
  `tests/channel-engine.ts` is the engine's commit rules in memory; keep it in
  step with the engine's.
- `bunx oxlint --type-aware apps/web/src/lib/queries/messages` (repository root).
- End to end: `apps/web/tests/channels-e2e/README.md`, with `VITE_ENABLE_CHANNEL_LOCAL_SYNC=true`.

## Gotchas

- Every selection of a message under a `seq` uses `ChannelMessageFields` (a
  reply preview `ChannelMessageBaseFields`, all it has): a partial one would
  raise the record's stamp over fields it left old. Read a page and a thread in
  separate operations.
- A timeline page is shown before the device stores it, and `stored` says how
  that ended: it never rejects, since a loader that moved on leaves it
  unawaited. A thread is shown once its pages are stored or were refused.
- When the cache refuses a read because the session changed after it was sent,
  the view reads again under the new one (`cacheSessionChanged`), and a query
  refused before it answered is sent again (`queryChannelNetwork`). A bare commit
  (`channelTimelineCommit`, the touch) takes the `cacheSessionGeneration`
  captured before its read.
- A timeline read touches a channel at most every 6 hours (`CHANNEL_TOUCH_INTERVAL_MS`),
  and a prewarm counts as a touch: `touched_at_ms` defaults to 0, which the
  30-day eviction would take at once. A touch counts only once the device
  stored it (`settled`), and only in the cache session it was sent in.
- Never import `account-scope` or `queries/client` here: `graphql-soup.ts`
  imports `channel-sync.ts`, and its tests mount neither.
- `effect` is allowed only in `channel-sync-runtime.ts`, `channel-writes.ts`,
  `channel-prewarm.ts` and the tests that run their effects (FE-46).
- Channel queries abort through `firstOrAborted`: urql replaces
  `fetchOptions.signal` with its own, so a signal passed there aborts nothing.
  While awaited, `queryChannelNetwork` names its own trace for urql
  (`TRACE_PARENT_CONTEXT_KEY`): urql's capture covers only the first request,
  and the cache sends a read again when a write lands while it is out.
- Start a request that follows an await inside its span with `span.run`, and
  capture a write's trace (`Telemetry.captureContext`) before any await.
- What failed with no connection loads again when it returns
  (`watchReconnect`, started before each request), and nothing else retries a
  window or thread that shows nothing. One that is shown but not held follows
  nothing, so it is also read again after a wait that doubles from
  `VIEW_RETRY_MS`, whether the server failed or the device lost, refused or
  could not read it, and at once when the connection or the device's database
  returns. A failed page waits for a scroll, the
  connection, or the same wait (`olderFailed`), so the call panel, which pages
  whenever paging is idle, asks at a bounded rate.
- The server's copy of a page or thread lacks what this device has queued: once
  the device holds it, read it from there again, change notice or not.
- A window is replaced only once all of it is read again
  (`channel.reload_window`): at most `RELOAD_EXTRA_PAGES` more pages than it
  showed, around its middle message when more than that arrived.
- Keep the prewarm pace under the engine's idle checkpoint quiet period, or
  every channel forces a checkpoint.
- A pushed message reaches an open timeline only once the device has reread
  it, and its unread notification often gets there first. Code that fetches
  what the timeline lacks waits for it to settle on the device path
  (`followsPushes`, `createRipeIds`), or every push fetches its own message
  again.

## Related

- Rules: `.agents/rules/web/libraries.md` (FE-46), `.agents/rules/observability.md`
- Docs: `docs/agent-guide/channels.md`, `apps/web/tests/channels-e2e/README.md`
