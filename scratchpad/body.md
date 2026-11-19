## Why

With channels read from the device cache (#10441), a person's own message
writes still went over REST. A send made while the connection was down was
lost with a failure toast, and a write that did succeed reached the device
cache only through the next push or catch-up. Reads were durable and
offline-capable; writes were not.

Fifth of a stack: sequence (#10440) -> GraphQL reads (#10442) -> cache
engine (#10443) -> web reads (#10441) -> queued writes (this PR). Based on
the web reads branch, so the diff here is only this layer.

`CI gate` has not run on this PR: PR CI runs only for PRs based on `main`.
It gets its own gate when retargeted at merge time; the layers below are
covered by the runs on #10440 and #10441.

## How it works

```
send / edit / delete / react   (signed-in person, device cache serving channels)
  -> hook's optimistic TanStack row, as before
  -> device queue: optimistic GraphqlChannelMessage row + durable mutation
       online   -> sendChannelMessage / editChannelMessage /
                   deleteChannelMessage / reactToChannelMessage
                   -> returned row replaces the optimistic one
       offline  -> stays queued (survives reload), delivered in order on reconnect
       busy     -> SERVICE_UNAVAILABLE: retried with backoff, never counted
       refused  -> rolled back, hook's usual toast and draft restore
anchored posts, other parents, agents and tokens, no device cache -> REST, unchanged
```

- A send's queue identity and nonce are the client-minted message id. The
  server's `post_once` returns the stored message for a repeated id, so a
  replay after a lost answer cannot post twice; `delete_once` returns the
  tombstone for a repeated delete. A replayed edit does not attach an
  entity the message already holds; react was already repeatable. A first
  delivery accepts an id minted up to 30 days ago, so a message typed
  during a long outage still posts.
- The hooks keep their optimistic rows, toasts and rollback and swap only
  `mutationFn`, which stays pending while the queue holds the write and
  rejects with the server's code when the write is refused. They run it
  while offline when the queue takes the write (TanStack would otherwise
  pause it in memory before the queue saw it); their REST branch waits for
  a connection as a paused mutation did.
- A send still pending after 5 s shows its message dimmed with "Not sent
  yet" beside the timestamp, in the session that sent it. This is its own
  commit so it can be dropped without touching the queue.
- The write guard's busy answer means nothing was written. The queue no
  longer counts an answer made only of `SERVICE_UNAVAILABLE` toward its
  ten-server-failure limit, and the four channel writes retry it with the
  queue's backoff (1 s doubling to 60 s) until the channel lets them in.
- A page of a channel the server answered first (a reload, a channel not
  yet held) is re-read from the device when writes for it are still
  queued, so the queued rows stay on screen.

## What

- `crates/messages`: `post_once` and `delete_once` on `MessageServiceApi`
  for callers that replay a write.
- `crates/graphql_channel/src/writes.rs`: the four mutations, each returning
  the written `GraphqlChannelMessage` (a root with its thread summary).
  They need a `ChannelWriteActor`, which the storage service inserts on HTTP
  requests only, and a personal session; agents, bots and API tokens keep
  posting through REST, where their attribution is decided.
  `MessageError::Contended` maps to `SERVICE_UNAVAILABLE`.
- `apps/web/src/lib/queries/messages/local/writes.ts`: builds the optimistic
  row, hands the write to the queue, waits for its settlement (following a
  superseded transaction to its replacement) and maps the stored row back to
  the REST message shape the hooks return.
- `mutations.ts`, `reactions.ts`: route channel writes there when the device
  cache serves channels; everything else stays on REST.
- `mutation-queue-runner.ts`, `graphql-mutation-retry.ts`: busy answers are
  retried and not counted (above).
- `generate-graphql-cache-entity-resolver-schema.ts`: argument paths are
  generated the way the formatter keeps them, so the generated file passes
  both its staleness check and the format check.
- Fixes for what the channels end-to-end suite showed on this path:
  - A message sent just before a reload was lost when the page went away
    before the queue stored it. A send is noted in `localStorage`
    (`unqueued-sends.ts`) until the queue holds it, and the next page to
    start resends what a page that is gone left noted. The queue lease
    such a page left on the head is released by the page-owner locks
    already on main (`mutation-queue-owner.ts`).
  - Two messages written just before a reload could reach the channel in
    the wrong order: the next page resent them in the order storage
    listed their notes. They are resent in the order written.
  - An enqueue claims the queue head for its page inside the cache
    engine. When the answer is lost, the head stays leased to a page that
    is not sending it, for five minutes. This was found by reading the
    code and has not been seen in the suite. After an enqueue loses its
    answer, the queue releases a lease this page took and sends nothing
    under (`releaseUnroutedLease`, `lease-unrouted`); it looks at the
    queue for this only then, since an inspection reads the whole queue.
  - The same send also came back as composer text after the reload: the
    cache host fails its requests when the page is hidden, which looked
    like a refusal. A send that fails while its page is being left stays
    pending (`unlessPageLeft`), so the draft is not restored.
  - A person's own quick sends showed out of order: the optimistic row
    was placed by this device's clock. `unplacedSortKey` places a queued
    send past every message the server has placed, and a drain asked for
    during a lease check or an empty claim is kept (`keepSooner`).
  - A reaction removed or added around a late answer was put back: the
    answer to a queued write reaches the views after pushes that are
    newer than it. `applyQueuedWrite` keeps the reactions on screen and
    `confirmQueuedReaction` lays only the person's own change over them.
  - A device page or thread read between a push reaching the views and
    the device storing it answered with older data. `pushesStored`
    (`catch-up.ts`) lets such a read wait, at most two seconds, and
    `source.ts` reads again, at most three times.
  - A message pushed while its channel was still loading stayed missing:
    the read the views make again to recover it was answered with the
    server page still being written to the device, which predates the
    message. A push forgets its channel's unwritten server pages
    (`forgetPendingChannelPages`), so that read asks again.
  - A send delivered after a reconnect stayed where it was written, above
    messages the server holds before it. A root of the newest page is
    moved to where the server's time puts it when its delivery arrives
    (`placeTopLevelMessageInMessageTimeline`); the session's sends still
    waiting stay last, in the order written.
  - A waiting message that follows the sender's own (the grouped layout)
    had no "Not sent yet" mark.
  - A message waiting in one window did not show in the device's other
    windows. A write still queued after a second is announced to them
    (`waiting-writes.ts`), and they read the device again.
  - An expanded thread the device could not load offline lost its reply
    count; the count stays until the replies load.
  - A thread read while the cache host was starting was answered over
    REST and never held by the device. It is now also loaded through the
    device in the background (`holdChannelThread`).
  - A reload within a moment of a push left the device's copy of the
    channel behind what was on screen, and it opened that way offline. A
    channel is noted in `localStorage` (`unstored-pushes.ts`) until the
    device has stored its pushes, and each page catches up the noted
    channels at start and after a reconnect.
  - A push was stored a quarter second after it was shown even in a quiet
    channel. A quiet channel's push is stored at once; one that arrives
    while another is being stored still shares the next request.
  - Scrolling back through history offline could land in the middle of
    it. The lookup of an unread thread's root fails offline, and
    `queryReadyGate` suspended on that failed query each time an older
    page gave it new options, which detached the channel and reset its
    scroll position. The gate no longer reads a query that failed
    without data.
  - A channel read back through its history could not be opened offline
    after a reload when the cache storage had been reset under the page
    in between: the reset dropped the stored pages and nothing stored
    them again. On a storage reset the open channels' pages and threads
    are read again (`rereadChannelsAfterStorageReset`); a channel not on
    screen is read again when next opened.
  - A reload in the first seconds of a page left the device without a
    thread or channel the person had just read, because the cache host
    had not started or had not finished storing it; offline the thread
    showed only its preview replies and the channel was empty. A latest
    page or thread the server answered is noted in `localStorage`
    (`unheld-reads.ts`) until the device holds it, and the next page to
    start holds what a page that is gone left noted (`holdUnheldReads`).
  - The prewarm kept asking for channels while offline, one failed and
    reported request each; it now stops without a connection.
- Rollout flag: `enable-channel-local-sync` (`enableChannelLocalSync`, no
  default) replaces the GraphQL cache flag as the gate in
  `channelCacheHost()`, so reads, live updates, catch-up, prewarm, the
  write queue and reactions stay on REST until PostHog answers on. A
  local or CI bundle sets `VITE_ENABLE_CHANNEL_LOCAL_SYNC`. With it off
  the other-window announcements are ignored and "Not sent yet" is not
  shown. Turning it off loses no write: the cache still delivers what
  its queue holds, and sends noted in `localStorage` for the queue are
  posted over REST under their own id (`left-behind-sends.ts`).
- `crates/messages/proofs`: the write-proof scripts are Bun TypeScript.
- Docs: web, `graphql_channel`, `messages`, `complete_graph` guides and the
  channels agent guide.

## Database review

No new or changed SQL. Two existing reads gain a caller:

| Statement | When | Rows | Index | Checked |
| --- | --- | --- | --- | --- |
| `repo.get` by `(parent, client id)` before a send | once per `sendChannelMessage`, before any write permit or transaction | 0 normally, 1 on a replay | `comms_messages_parent_identity` point read | plan on a 52k-message local database |
| `get_root` hydration after a root write | once per write to a root message, on the pool after the command returns, not under the write gate | 8-10 small indexed reads; the live-reply count scales with that thread's replies | `idx_comms_messages_thread_active_created` (index-only count), `idx_comms_messages_thread_order` (preview, LIMIT 3) | plans for count and preview on a 250-reply thread; attachment, reaction and bot lookups reasoned from their index definitions |

No `block` or `fix` findings.

## Follow-ups

- A send first delivered more than 30 days after it was typed is refused
  by the id-age check and rolls back.
- A replayed edit publishes its edit event again; the content is the same.
- The backend must be deployed before a web build that sends these
  mutations: a server without them refuses the write permanently.
- The PostHog flag `enable-channel-local-sync` exists and is on for
  internal staff only; everyone else stays on REST until it is widened.
- Commit `996e65a984` does not build on its own: it imports
  `left-behind-sends.ts`, which the next commit adds. The branch head
  builds; the history is left as pushed.
- The flag is read when a channel query or mutation builds its options,
  so a flip while the app is open takes full effect at the next reload;
  until then an offline send made after a flip to on waits in the page,
  as on REST.
- A write queued while the flag was on waits for the GraphQL cache to
  run on that device; a device where the cache is also turned off keeps
  it queued until the cache runs again.
- The queue is one FIFO per device, so a write that keeps retrying holds the
  person's other queued writes behind it.
- A write refused after a reload removes its row without a toast, since the
  hook that would show it is gone.
- A reply sent offline does not raise the root's cached reply count until
  the push or catch-up arrives.
- A thread page the server answered does not show a queued reply until it
  is delivered; channel pages re-read the device once the answer is stored.
- A write held while its cache host is retired stays pending in the hook;
  the queue still delivers it.
- A write whose enqueue answer is lost is reported to its hook as
  failed, though the queue holds and delivers it.

- A left-behind read that fails while online is dropped, not retried;
  the prewarm covers recent channels, an old thread is read again when
  next opened.
- The notes of pushes and reads awaiting the device are not scoped to
  an account; another account's notes are refused by the server and
  dropped.
- Only sends are noted ahead of the queue; an edit, delete or reaction
  made in the last moment before a reload can still be lost.
- The answer to a queued edit keeps the reactions on screen but not other
  fields a newer push may have changed (a delete pushed before the edit's
  answer arrives).
- Grouped thread replies in the standalone thread view have no "Not sent
  yet" mark.
- The first send after a page opens reaches the server one to two
  seconds after it is written; later sends take well under a second.
  The queue waits up to two seconds for the email draft store to open
  before its first delivery.
- A push is stored on the device 0.1 to 0.2 s after it is shown when the
  cache is idle, and one to six seconds after while the cache is busy
  (the first half minute of a page); a reload inside that time, followed
  by opening offline, shows the channel without that message until the
  next connection.
- Another window's waiting message can sit out of order until every
  waiting send before it is delivered.

