# Channel local sync (web client)

## What it is

The channels client for devices that keep channels in the GraphQL cache engine
(`enable-channel-local-sync`). A channel's timeline, threads and writes read
from and go through the device; the server fills what the device lacks and the
`channelTimelineUpdates` subscription keeps it current. With the flag off, on a
host without the channel commands, and for non-channel parents, the REST and
TanStack path in `../` runs untouched. A host whose database is away for now
(`paused`) stays the channels' host: never read or write around its queue.

## How it works

- Read: `channel-pages.ts` asks the host for a page (`channelTimeline`); a
  covered page is read by key (`readRecordsByKeys`), a miss fetches
  `ChannelTimeline` and commits its coverage and a lower sequence bound once the
  normalized cache holds the records. Threads do the same per root
  (`channel-thread.ts`, `ChannelThread`, coverage with `threadRootId`).
- Follow: one runtime per host (`channel-sync-runtime.ts`) tracks the sequence
  the device holds per channel, applies subscription frames
  (`channel-stream.ts`), catches up open channels on reconnect, and tells open
  timelines and threads to reread (`onChanged`). A drop ends every scheduled
  catch-up still out: a changes page read before can land after a frame of the
  next connection and write older records over it. On one connection one
  catch-up waits at a time: a later ask leaves it in place unless it would
  start sooner, so a busy channel's frames cannot postpone it, and one already
  running finishes with the waiting one after it. A catch-up or read begun
  under an earlier connection never marks a channel current (`epoch`, which
  moves on every drop and connect); one that moved the device, storing an
  older snapshot over what a later catch-up applied, makes it not current and
  catches it up again, as does a read that finds the device below what it
  read (unless one waits already, a retry included); a page out when a read
  lowers the device below its cursor is read
  again from there, outside the page budget. Each catch-up commit runs in a
  `channel.catch_up.commit` span. A last page out while a newer frame stored records is
  read again (`MAX_PAGE_REREADS`); the repair is left in place until a reread
  holds (for an earlier page, until a later page reaches the frames that
  overtook it, rising to each page before then), so a drop or a
  failure on the way repairs from it; a channel with a repair left is not
  current, a server read included. A page is watched for frames until its
  commit is answered, and a commit that finds the sequence moved by a read
  replays from it (a commit of removals only that finds it at or past the
  page goes on from the page), the channel not current until
  then; this assumes the device answers commits in the order it applies
  them. A frame past a page's cursor that stored while it or an earlier
  page was out is covered by the first later page that lands through it
  (the server reads the log before the records), and asks for no repair. Only the request
  can be interrupted: a commit the device takes always records its sequence
  and tells the views, and one it leaves unanswered past `COMMIT_BUDGET_MS`,
  a reset's included, frees the channel and makes the runtime read the
  sequence from the device again; a page commit that fails after a newer
  frame stored records leaves a repair from the page (none once the channel is forgotten). A failed catch-up of a
  channel on screen is tried again after a wait that doubles from
  `CATCH_UP_RETRY_MS` to `CATCH_UP_RETRY_MAX_MS` (reset by any success), unless another is already
  scheduled or the channel closed meanwhile. `ensureCurrent`'s catch-up runs in the runtime's scope and goes
  on over HTTP while the socket is down; the next connection or dispose ends
  its request (`skipped`), and prewarm then asks once more, unless its pass was replaced, since a reconnect
  catches up only the channels on screen. A window or a thread that
  failed to load, and an older or newer page that failed, load again when the
  connection comes back (`watchReconnect`, started before each request, so a
  request that fails after the connection is already back loads again at
  once): nothing else retries them on its own (a failed window still shows
  Retry), nor a window read again after a session change, except the wait
  after a failed page below. A page the device
  failed to store is read again from its own cursor, by the next page in that
  direction or the connection's return, and given up if refused again: the
  window then follows the device only once it is loaded again. From a page's
  merge until its outcome is recorded, the window is neither read from the
  device nor kept for the next mount; a change that came meanwhile, or while
  the window loaded, is read once it holds. A window loaded again forgets the
  old window's pages, and nothing waits for a replaced window's reads or
  stores, nor for its pages'. A failed page sets `pageFailed` (`olderFailed`)
  until a scroll, the connection, or a wait that doubles from `PAGE_RETRY_MS`
  to `PAGE_RETRY_MAX_MS`, so the call panel, which pages whenever paging is
  idle, asks at a bounded rate.
  Tabs share the device but hear only their own writes and the server's
  frames, so a write announces its channel to the other tabs once the queue
  stores it and once it settles (`channel-tab-writes.ts`, the
  `macro.channel-timeline.writes` BroadcastChannel; a tab ignores its own),
  and their runtimes tell the channel's views to reread.
- Write: `channel-writes.ts` enqueues the `*ChannelMessage` mutations on the
  durable cache mutation queue and waits for their settlement; a retired host
  (`graphql-soup.ts` cleanup, or recovery given up until a reload) ends the
  writes still waiting, `CACHE_RETIRED`. When the cache session changes (the
  engine returned from the back/forward cache, or reset), a waiting write asks
  the queue whether it still holds the write: if not, an
  edit, delete or reaction resolves only when the device copy shows it
  (`applied`; another tab may have rolled it back, `NOT_APPLIED`), and a send
  answers from the device copy, else the server copy (`ChannelMessage`), else
  `DELIVERY_UNKNOWN`: a request the server has not answered can still
  commit, so an absent copy proves nothing. It asks three times, reading the
  device again between questions (another tab may store the send meanwhile);
  a request unanswered within `SERVER_LOOKUP_BUDGET_MS` is cancelled, so the
  next question sends a new one rather than joining it, and an answer waits
  at most `SERVER_COPY_STORE_BUDGET_MS` for the device to store it (one stored
  later tells the views again, since their reread came first). The composers
  send a restored draft of that message again, from the same person to the
  same place and from any view of it, under the same id
  (`features/channel/Input/utils/uncertain-sends.ts`, which ignores mention
  order), until another message is sent there; the ids live in memory, so a
  reload forgets them, and so does the end of a session. The
  reply composer awaits its send, since it unmounts as it sends, and puts a
  failed reply back through the thread's stored draft, which every open reply
  input holds (`features/channel/Thread/reply-drafts.ts`): a view opened later
  shows it, a newer draft in any view is kept (a quote builds on it too), and
  nothing is written back by a composer that was open before or during a
  sign-out, or before a sign-in replaced its session
  (`composerStorageWritable`). A queue that
  cannot be read is asked again with backoff, except after a reset, which ends
  the write with `CACHE_RESET`. A reset and a retired host fail only edits,
  deletes and reactions: a send already handed to the queue may have left it, so
  it is `DELIVERY_UNKNOWN`. A write is its transaction id and its
  mutation id: transaction ids restart when the queue is rebuilt. The queue
  replays only sends and deletes the server answered `SERVICE_UNAVAILABLE`
  (`graphql-mutation-retry.ts`): the server dedupes them by message id, while a
  replayed edit or reaction could undo a newer one; every write is still sent
  again after a transport failure. A send the queue stops retrying, or whose
  commit the device could not store, answers the same way, from the device copy
  first; one that never reached the queue (`write-not-admitted`) is a refusal.
  A write whose enqueue lost its
  answer (`ADMITTED_ENQUEUE_UNCERTAIN_ERROR_CODE`) looks for its mutation id in
  the queue: it waits for the one it finds, answers as a write that left the
  queue when there is none, and a queue that cannot be read makes a send
  `DELIVERY_UNKNOWN`, since a device copy may be the queue's own optimistic
  record. A send that went straight out and lost the server's answer asks the
  server, then is `DELIVERY_UNKNOWN`. Recovery runs as
  `channel.write.recover` in the write's trace, every lookup included. A page
  and each read of it again run in one `channel.load_page` span.
- Outage: while the host is `paused` (or being proven readable again after it
  answered, or was away, before: `sessionChannelHost` in `channel-flag.ts`),
  open channels stay as they are, new ones load from the server unheld, and
  writes wait (`channel.write.await_cache`) for the queue. A channel's writes
  reach it in the order they were asked for, each once the one before has been
  handed over (`takeTurn`), and only a host the session serves from takes them
  (`serving`). One that finds the database away as it is handed over is held
  (`holdWhilePaused`, `CachePausedError`) instead of sent straight out, and
  handed over again. `restartCache` in `graphql-soup.ts` ends the outage by
  calling `resumed()` on the host's runtime, which catches up the channels on
  screen and reloads what they could not hold, and on its writes. A window that
  was still storing a page then is loaded again if the store fails. A host the
  page stops trying to prove (`recovery-required`) is retired, and channels go
  over REST until a reload.
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
  While awaited, `queryChannelNetwork` names its own trace for urql
  (`TRACE_PARENT_CONTEXT_KEY`): urql's capture covers only the first request,
  and the cache sends a read again when a write lands while it is out.
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
