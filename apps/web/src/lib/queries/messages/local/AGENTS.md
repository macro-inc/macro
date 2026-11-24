# Channel local sync (web client)

## What it is

The channels client for devices that keep channels in the GraphQL cache engine
(`enable-channel-local-sync`). A channel's timeline, threads and writes read
from and go through the device; the server fills what the device lacks and the
`channelTimelineUpdates` subscription keeps it current. With the flag off, on a
host without the channel commands, and for non-channel parents, the REST and
TanStack path in `../` runs untouched.

## How it works

- Read: `channel-pages.ts` asks the host for a page (`channelTimeline`); a
  covered page is read by key (`readRecordsByKeys`), a miss fetches
  `ChannelTimeline` and commits its coverage and a lower sequence bound once the
  normalized cache holds the records. Threads do the same per root
  (`channel-thread.ts`, `ChannelThread`, coverage with `threadRootId`).
- Follow: one runtime per host (`channel-sync-runtime.ts`) tracks the sequence
  the device holds per channel, applies subscription frames
  (`channel-stream.ts`), catches up open channels on reconnect, and tells open
  timelines and threads to reread (`onChanged`). A window or a thread that
  failed to load, and an older or newer page that failed, load again when the
  connection comes back (`watchReconnect`, started before each request, so a
  request that fails after the connection is already back loads again at
  once): nothing on screen retries them, nor a window read again after a
  session change. A page the device failed to store is read again from its
  own cursor, by the next page in that direction or the connection's return,
  and given up if refused again: the window then follows the device only
  once it is loaded again. From a page's merge until its outcome is recorded,
  the window is neither read from the device nor kept for the next mount; a
  change that came meanwhile, or while the window loaded, is read once it
  holds. A window loaded again forgets the old window's pages, and nothing
  waits for a replaced window's reads or stores, nor for its pages'. A failed
  page sets `pageFailed` (`olderFailed`) until a scroll, the connection, or a
  wait that doubles from `PAGE_RETRY_MS` to `PAGE_RETRY_MAX_MS`, so the call
  panel, which pages whenever paging is idle, asks at a bounded rate.
  Tabs share the device but hear only their own writes and the server's
  frames, so a write announces its channel to the other tabs once the queue
  stores it and once it settles (`channel-tab-writes.ts`, the
  `macro.channel-timeline.writes` BroadcastChannel; a tab ignores its own),
  and their runtimes tell the channel's views to reread.
- Write: `channel-writes.ts` enqueues the `*ChannelMessage` mutations on the
  durable cache mutation queue and waits for their settlement; a retired host
  (`graphql-soup.ts` cleanup) fails the writes still waiting. When the cache
  session changes (the engine returned from the back/forward cache, or reset),
  a waiting write asks the queue whether it still holds the write: if not, an
  edit, delete or reaction resolves only when the device copy shows it
  (`applied`; another tab may have rolled it back, `NOT_APPLIED`), and a send
  answers from the device copy, else the server copy (`ChannelMessage`), else
  `NOT_SENT`, or `DELIVERY_UNKNOWN` when the server cannot say; the composers
  send a restored draft of that message again, from the same person to the
  same place and from any view of it, under the same id
  (`features/channel/Input/utils/uncertain-sends.ts`, which ignores mention
  order), until another message is sent there. The
  reply composer awaits its send, since it unmounts as it sends, and puts a
  failed reply back through the thread's stored draft, which every open reply
  input holds (`features/channel/Thread/reply-drafts.ts`): a view opened later
  shows it, a newer draft in any view is kept (a quote builds on it too), and
  nothing is written back by a composer that was open before or during a
  sign-out (`composerStorageWritable`). A queue that
  cannot be read is asked again with backoff, except after a reset, which
  fails the write with `CACHE_RESET`. A write is its transaction id and its
  mutation id: transaction ids restart when the queue is rebuilt. The queue
  replays only sends and deletes the server answered `SERVICE_UNAVAILABLE`
  (`graphql-mutation-retry.ts`): the server dedupes them by message id, while a
  replayed edit or reaction could undo a newer one; every write is still sent
  again after a transport failure. A send the queue stops retrying answers
  with the server copy when there is one. Recovery runs as
  `channel.write.recover` in the write's trace.
- Ahead: `channel-prewarm.ts` fetches unread then recent channels while the
  person is idle, and evicts channels untouched for 30 days. A pushed frame
  for a channel the device does not hold gives it an empty sync row once the
  device writes it, so eviction finds the records the frame stored. Eviction,
  here or in another tab (the `macro.channel-timeline.evictions`
  BroadcastChannel), makes the runtime forget the channels it removed
  (`forget`), so a later frame adds the row again.

## Start here

- `channel-sync.ts`: the per-host factories every caller goes through.
- `../channel-timeline-source.ts`: `useChannelReadPath`, the once-per-mount
  choice between device and REST; `../thread-replies.ts` uses the same choice.
  A flag PostHog has not answered yet reads as off: REST never waits for it.
  A link to a message learns whether it is a reply from the device copy on the
  device path (`useChannelMessageResolver`), and from the server only when the
  device lacks it, so a link opens with no connection.
- `channel-resets.ts`: counts deletes and evictions per host, so a page
  fetched across one commits no coverage. Tabs share the device, so a fill
  also holds the `macro.channel-timeline.deletes` Web Lock shared from before
  its fetch until its coverage is sent (`holdAgainstDeletes`), and eviction and
  resets take it exclusive (`whileNoFills`): eviction gives up after 5 s and
  tries next round, a reset runs anyway after 30 s. A fill holds the lock at
  most 20 s (`FILL_HOLD_LIMIT_MS`), and a delete too (`DELETE_HOLD_LIMIT_MS`): one
  the device has not answered by then lets fills back in, and is counted
  again once it answers. A fill that finds a delete waiting, or
  outlived its hold, commits no coverage and reports `yielded`: the open
  timeline or thread shows what it read, waits for the delete
  (`afterDeletes`) and reads again, at most twice.

## Checks

- `bun run test -- src/lib/queries/messages` (from `apps/web`).
- `bunx oxlint --type-aware apps/web/src/lib/queries/messages` (repository root).
- End to end: `apps/web/tests/channels-e2e/README.md`, with `VITE_ENABLE_CHANNEL_LOCAL_SYNC=true`.

## Gotchas

- Never commit coverage or a sequence before the records are stored:
  `queryChannelNetwork`'s `cached` settles only then. When the cache refuses
  a read because the session changed after it was sent, `cached` fails as a
  session change (`cacheSessionChanged`) and the view reads again.
- Capture `cacheSessionGeneration` before a fetch and pass it to the commit; a
  later session must not store what an earlier one read.
- A read touches a channel at most every 6 hours (`CHANNEL_TOUCH_INTERVAL_MS`),
  and a prewarm counts as a touch: `touched_at_ms` defaults to 0, which the
  30-day eviction would take at once. A touch counts only once the device
  stored it (`settled`), and only in the cache session it was sent in: a
  refused one, or one from an earlier session, is sent again with the next
  read. A read from a session that is no longer current marks nothing; one
  in the session whose cleanup still runs marks (`touchSessionAccepts`).
- `effect` is allowed only in `channel-sync-runtime.ts`, `channel-writes.ts`,
  `channel-prewarm.ts` and the tests that run their effects (FE-46).
- Channel queries abort through `firstOrAborted`: urql replaces
  `fetchOptions.signal` with its own, so a signal passed there aborts nothing.
- Start a request that follows an await inside its span with `span.run`, and
  capture a write's trace (`Telemetry.captureContext`) before any await.
- A page's `stored` and a thread's store acknowledgements never reject: a
  loader that moved on leaves them unawaited. The store runs in a
  `channel.page.store` child span of the page.
- Keep the prewarm pace under the engine's idle checkpoint quiet period, or
  every channel forces a checkpoint.
- A pushed message reaches an open timeline only once the device has reread
  it, and its unread notification often gets there first. Code that fetches
  what the timeline lacks waits for it to settle on the device path, as the
  unread navigation's parent lookup does (`followsPushes`, each parent on
  its own monotonic clock, `createRipeIds`), or every push fetches its own
  message again.

## Related

- Rules: `.agents/rules/web/libraries.md` (FE-46), `.agents/rules/observability.md`
- Docs: `docs/agent-guide/channels.md`, `apps/web/tests/channels-e2e/README.md`
