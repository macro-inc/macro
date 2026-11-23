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
  timelines and threads to reread (`onChanged`).
- Write: `channel-writes.ts` enqueues the `*ChannelMessage` mutations on the
  durable cache mutation queue and waits for their settlement; a retired host
  (`graphql-soup.ts` cleanup) fails the writes still waiting.
- Ahead: `channel-prewarm.ts` fetches unread then recent channels while the
  person is idle, and evicts channels untouched for 30 days. A pushed frame
  for a channel the device does not hold gives it an empty sync row once, so
  eviction finds the records the frame stored.

## Start here

- `channel-sync.ts`: the per-host factories every caller goes through.
- `../channel-timeline-source.ts`: `useChannelReadPath`, the once-per-mount
  choice between device and REST; `../thread-replies.ts` uses the same choice.
  A flag PostHog has not answered yet reads as off: REST never waits for it.
- `channel-resets.ts`: counts deletes and evictions per host, so a page
  fetched across one commits no coverage.

## Checks

- `bun run test -- src/lib/queries/messages` (from `apps/web`).
- `bunx oxlint --type-aware apps/web/src/lib/queries/messages` (repository root).
- End to end: `tests/channels-e2e/README.md`, with `VITE_ENABLE_CHANNEL_LOCAL_SYNC=true`.

## Gotchas

- Never commit coverage or a sequence before the records are stored:
  `queryChannelNetwork`'s `cached` settles only then.
- Capture `cacheSessionGeneration` before a fetch and pass it to the commit; a
  later session must not store what an earlier one read.
- A read touches a channel at most every 6 hours (`CHANNEL_TOUCH_INTERVAL_MS`),
  and a prewarm counts as a touch: `touched_at_ms` defaults to 0, which the
  30-day eviction would take at once.
- `effect` is allowed only in `channel-sync-runtime.ts`, `channel-writes.ts` and
  `channel-prewarm.ts` (FE-46).
- A page's `stored` and a thread's store acknowledgements never reject: a
  loader that moved on leaves them unawaited. The store runs in a
  `channel.page.store` child span of the page.
- Keep the prewarm pace under the engine's idle checkpoint quiet period, or
  every channel forces a checkpoint.

## Related

- Rules: `.agents/rules/web/libraries.md` (FE-46), `.agents/rules/observability.md`
- Docs: `docs/agent-guide/channels.md`, `tests/channels-e2e/README.md`
