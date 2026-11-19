## Why

Channels always open from the network: every open, reload and switch waits
for a REST page, and a channel cannot be shown offline or on a slow link
until that page arrives. With the sequence, the GraphQL reads and the cache
engine below this PR, the web client can keep channel timelines on the
device, answer opens from it, and stay current by replaying changes.

Last of a stack: sequence -> GraphQL reads -> cache engine -> web (this PR).
Writes (send, edit, delete, react) stay on REST here.

This PR is opened against main so CI can run on the whole stack, so its diff
includes the three layers below (#10440, #10442, #10443). Its own commits
are the last ten, from `feat(channels): read channel timelines from the
device cache` on; review those here and the rest in their own PRs.

CI on this PR covers #10442 and #10443 too. Every job passes except
`iOS Native Check` and `Android Native Check`. They fail because the cache
engine layer changes native code (the native cache plugin gains four
commands and the device storage schema moves to version 13) without a
native version bump. The bump is a release decision and is not made here:
`just ios-bump` and `just android-bump` raise each platform's release
numbers and, by default, the floor in `apps/web/min-native-build.json`, after
which the web bundle requires that build and the store builds must ship
before the web deploy. `--no-min` bumps without raising the floor, which is
enough for this stack: an older native build answers `unsupported` and
keeps reading channels over REST, so the web bundle can ship first.

## How it works

```
open / page / jump
  -> device: channelTimeline            (held and covered -> render, no request)
  -> miss: GraphQL channelTimeline      (commit rows + coverage + seq to device)
  -> GraphQL fails: existing REST read

push message_update (seq)               -> patch the open view from the event
                                        -> one coalesced channelChanges(after seq)
                                           commits the delta to the device
reconnect / reopen                      -> channelChanges(after held seq)
                                           resetRequired -> drop coverage, refetch latest page
idle                                    -> prewarm up to 40 unread + 20 most recent channels (latest page)
                                           evict channels not opened for 30 days
```

- Rollout rides the existing `enable-graphql-soup` flag; without it, or on a
  host that answers `unsupported` (an older native build), the REST path is
  unchanged.
- Opening never waits on the device. While the cache is starting, and for the
  latest page of a channel not yet known to be held, the server is asked
  alongside the device and the first answer wins. Concurrent readers of one
  page share one load.
- Own writes keep their optimistic row; the echo and the change replay land
  on the same record key, so there is no duplicate.

## What

- `apps/web/src/lib/queries/messages/local/`: page loader, record mapping to
  the shapes every channel surface already renders, catch-up, prewarm,
  eviction, with unit tests.
- Channel timeline, thread and message-lookup queries read through it.
- Those timeline and thread queries run `offlineFirst` when the cache serves
  channels, so a channel held on the device opens with no connection. A read
  the device cannot serve offline waits for the connection and keeps its
  retry (`retryOnceOnline`); such a miss is not reported as a fault.
- `sync.ts`: pushes note the committed sequence.
- GraphQL documents and generated types for the four channel operations.
- Spans: `channel.timeline_page` with `page.source`
  (device / server / shared / server-pending / not-ready / unsupported),
  catch-up and prewarm spans.
- `apps/web/AGENTS.md` describes the read path.

### Old against new, same machine, same data (median first paint, n=6)

| Case | Old | New |
| --- | --- | --- |
| Switch to a channel held on the device, throttled network | 264-294 ms | 186-234 ms |
| Switch to a channel held on the device, fast network | 178-217 ms | 199-233 ms |
| Switch to a channel not held | 172-220 ms | 172-189 ms |
| Revisit a channel | 112-149 ms | 109-144 ms |
| Requests / bytes before paint on revisit | 3 / ~8.1 KB | 2 / ~1.7 KB |
| Reload | 826-879 ms | 846-906 ms |
| Reload, throttled | 1173-1225 ms | 1214-1292 ms |
| Cold open, fresh browser | 1254-1290 ms | 1240-1276 ms |
| Cold open after login | 1202-1210 ms | 1215-1259 ms |
| Cold open at an old message | 1287-1376 ms | 1323-1456 ms |
| Cold open at a thread reply | 1234-2018 ms | 1237-2041 ms |

The gain is on a held channel over a slow network. Reload and cold open are
not faster: on a cold boot the browser cache engine starts later than the
network answers, which is why the open races the two.

### Staying current, two people (old / new)

| Event | Old | New |
| --- | --- | --- |
| New message on screen after send (median) | 49 ms | 51 ms |
| Edit / reaction / thread reply / delete on screen | 53 / 40 / 60 / 55 ms | 48 / 57 / 59 / 50 ms |
| Member added / removed row | not measured | 114 / 79 ms |
| Missed messages on screen after 30 s offline | 107 ms | 366 ms |
| 1,106 changes while offline (past the reset limit) | not measured | latest on screen 936 ms after reconnect |

After each step a fresh tab with every channel request blocked showed the
server's newest message, order, content and reactions, and no deleted
message, from the device alone.

### Own writes (old / new)

Sent message on screen 36 / 26 ms and one row after the echo; a failed
request and a 503 from the write guard both remove the row, show the failure
toast and restore the draft, in both; a retry and a reopen show the right
rows in both.

### Prewarm load at start

Prewarm takes up to 40 unread channels (latest activity first) and the 20
most recently viewed, from two server-ordered, server-filtered channel lists
read through the cache. One request at a time, only after 3 s without input
and an idle callback, checked before every channel. A held channel is caught
up with `channelChanges`, not read again.

A person with 300 unread channels, first 150 s after start, untouched:

| | Requests | Summed request time | Bytes |
| --- | --- | --- | --- |
| Everything except prewarm (same as the old path) | 127 | 6,959 ms | 350 KB |
| Prewarm | 52 | 822 ms | 52 KB |

Prewarm ran between 6 s and 33 s after start, never more than one request in
flight. Worst case per start: 2 list requests and 60 channel requests.

## Follow-ups

- Move send, edit, delete and react onto the cache's durable queue (next PR
  in the stack).
- Catch-up after a short disconnect is slower than the old refetch (366 ms
  against 107 ms); the cause is not investigated.
- A cold deep link to an old message is 3-6% slower (36-82 ms); not
  investigated.
- First paint of a held channel on a fast network is 4-12% later than the
  old path; not investigated.


