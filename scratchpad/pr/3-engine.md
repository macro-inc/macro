## Why

The device cache stores records and query results, but it cannot answer "the
page of this channel before this message" by itself: it has no order over
messages and does not know which stretches of a channel it holds. Without
that, every open, scroll back and jump has to ask the server.

Third of a stack: sequence -> GraphQL reads -> cache engine (this PR) -> web.
Nothing calls the new host methods until the web PR.

Stacked on the GraphQL reads PR so the diff shows only this layer. `CI gate`
has not run on this PR: CI runs only for PRs based on main. It is covered by
the run on the top of the stack (#10441), whose diff contains this one, and
gets its own gate when retargeted to main at merge time.

## How it works

The engine keeps, per channel (and per thread), an index of record keys by
sort key and a list of covered ranges: stretches known to be complete. A read
is answered from the device only when the requested window lies inside one
covered range; otherwise it reports a miss and the caller fetches.

```
channelTimeline({channelId, threadRootId?, limit, before | after | around})
  -> {kind: 'page', covered, keys, olderCursor, newerCursor, seq, optimistic}
   | {kind: 'unsupported'}
channelTimelineCommit({channelId, coverage?, removedKeys?, seq?, touchedAtMs?, reset?})
channelTimelineEvict({touchedBeforeMs, maxChannels})
channelTimelineStats()
```

- A commit merges a fetched page's range into coverage, so adjacent pages
  join into one range and a jump leaves a separate island.
- The channel's sequence is stored with it. `seq` advances only from the
  value the caller read (`advance from -> to`), so two tabs cannot skip a
  change; `reset` drops coverage and keeps records.
- Eviction removes channels not touched since a given time, in batches.

## What

- `cache-core`: `channel_timeline` engine: index, coverage ranges, sequence
  state, eviction, with unit tests for range merging and cursors.
- `cache-turso`: tables for the index, coverage and sync state (schema v13).
- `cache-wasm`: the four calls exposed to the browser host.
- Web cache host and worker protocol carry the calls.
- Native plugin (`apps/web/tauri/graphql_cache_plugin`) serves them from the
  native engine. A native build without this change answers `unsupported`
  and the web client falls back to the network.

Release note: the schema moves to v13, so native apps need a build that
includes this PR before they can serve channels from the device; older builds
keep working through the `unsupported` fallback.
