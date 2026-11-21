# Channel participants differential

Proof harness for the change that swaps the channel participants query's
`queryFn` from main's REST read to a by-id GraphQL read (`soupEntity`), with a
REST fallback for unjoined public channels. The query's key, `staleTime` and
mutations stay main's. It is not shipped: nothing in the app imports it.

## How it works

`harness.tsx` is loaded by URL into a signed-in app page served by the local
stack's Vite. In that page it mounts, for each channel, both readers side by
side, with the app's own QueryClient, GraphQL client, persisted cache and
websocket:

- **old**: main's reader and mutations, copied verbatim into `main/` from the
  merge base (`check-copies.sh` proves the copies match `git show`);
- **new**: the head's `useChannelParticipantsQuery` and mutations (main's,
  with the new `queryFn`). The copies in `main/` get a key prefix of their
  own (`check-copies.sh`), since the head keeps main's key and both readers
  would otherwise share one cache entry.

One network write serves both sides: each side's add/remove mutation calls the
storage client, and a gate hands both the same promise. The gate can hold the
request (to read the pending state) or fail it.

`driver/run.ts` signs in ten synthetic users (`px<n>@<run>.example.com`), opens
five pages, and runs seeded random sequences of membership writes on
generated channels (`driver/gen.ts`): add, remove, leave, join a public
channel, request and approve, team auto-join, role change, bot add and
remove, delete, plus direct database edits for ties and synthetic or unicode
rows. After every step it compares both readers in every open page, in four
modes:

| mode | when |
| --- | --- |
| `pending` | an add or remove held at the network, failed ones included |
| `read-after-write` | the writer's own page, straight after the write |
| `live` | every open page, polled until the head matches the database or `PX_LIVE_MS` (5 s) passes; a read still differing then keeps being read until it stops differing or `PX_LATE_MS` (30 s) passes, and the record says when (`caughtUpMs`) |
| `reload` | every page reloaded and remounted; one page stays closed between steps and reopens on its persisted cache |

Every few steps it compares the form tile counts (`createInvitedSource`) for
forms shared with the batch's channels. `driver/compare.ts` compares each
snapshot at two levels: every field the readers return, and what callers
show or decide (`contract.ts`: the projections the Participants tab, share
button, mentions, top icon, group label, DM agent check and block adapter
compute from the reader). Each side is also compared with the database.

`driver/case37.ts` makes the suspected causes of the first differential's
case 37 happen on purpose: the head's by-id read delayed, failed once,
failed for good, answered with GraphQL errors, its connection dropped; main's
REST read failed; under concurrent load; and a stale cache entry.

## Running

Against a running local stack (`just run_local --instance <name>`):

```sh
apps/web/src/__proof__/participants/run.sh            # everything
apps/web/src/__proof__/participants/run.sh mutants    # one part
```

Knobs (env): `PX_SEQS`, `PX_STEPS`, `PX_BATCH`, `PX_LIVE_MS`, `PX_LATE_MS`, `PX_SEED`,
`PX_LOAD`, `PX_MUTANT`, `PX_ORIGIN` (the stack's Vite), `PX_PG` and
`PX_REDIS` (its containers). Each driver runs in a network namespace of its own with the
stack's ports forwarded (`apps/web/tests/view-parity/isolated-network.sh`;
`PX_PORTS` overrides them, `PX_NETNS=0` turns it off): Chromium fails every
request in flight with `net::ERR_NETWORK_CHANGED` when another container
changes the host's interfaces. Results go under `PX_ROOT`; `driver/report.ts`
summarizes them and `driver/rejudge.ts` re-reads one run's records with the
current comparison, and `driver/livelag.ts` counts which reader still lagged the
database at the live bound. Don't edit files the page imports while it runs: Vite
reloads the pages.

The load runs push the local document storage service past its container's
default limit of 1,024 open files (it reaches about 4,300). At the limit it
refuses connections and database work (`os error 24` in its log), and the
reads then stall or fail for reasons outside the code under test. Run the load
runs with the limit raised, by recreating that one container with an extra
Compose file:

```yaml
services:
  document_storage_service:
    ulimits:
      nofile: { soft: 65536, hard: 65536 }
```

`driver/stall.ts` reloads a page over 40 channels with and without load and
times each reader's first data, and records the head's by-id requests
(answered, failed, or refused with a GraphQL error).

## Differences

`driver/report.ts` sorts every difference into a class with a known cause or
leaves it unexplained. A clean run has none unexplained; a mutant run must
have some.

| class | cause | why callers can't see it |
| --- | --- | --- |
| `field.joined_at.format` | REST writes `Z`, GraphQL `+00:00` (the head now rewrites it, so this should not appear) | same instant; no caller reads `joined_at` |
| `field.left_at.missing` | rows that carry `left_at: null` on one side only | no caller reads `left_at` |
| `field.joined_at.client-stamped` | both sides show an add with the time they stamped when it was sent | client clocks; no caller reads `joined_at` |
| `field.joined_at.main-stamped` | main keeps the time it stamped when sending an add after the add lands (`main/participants.ts:61`, never reread); the head shows the database's | no caller reads `joined_at`; both orders agree with the database |
| `tie-order` | rows with the same `joined_at`: REST orders by `joined_at` alone, the soup read aggregates without an order | neither side defines it; main's own order varies between reads |
| `main-stale` | main differs from the database (people, order, or join times changed since its read), the head matches it | the head is right |
| `state.both-empty` | neither reader has rows and every caller decides the same; only the pending, loading or success flags differ: a reader still pending after its own write cancelled its first read (`main/participants.ts:38` and `:103` cancel it, and the refresh after the write, `:213` and `:262`, refetches only inactive readers, `main/channel-participants.ts:46`). The head keeps main's mutations, so this is main's behaviour on both sides | `contract.ts` reads the flags as each caller does, and those all agree |
| `live.late` | a live read past `PX_LIVE_MS` that stopped differing within `PX_LATE_MS` of the write with no reload in between: its update came late, under load | for the seconds it was late, the caller showed the roster from before the write, as main does in the other direction (`main-stale`); a lost update never catches up and stays unexplained (the `skip-live` mutant) |
| `main-stale` (channel deleted, or viewer refused) | main keeps the rows it read before the channel was deleted or the viewer lost access (its refetch fails, 404 or 401, and TanStack keeps the last data); the head shows none | the head is right: the server shows this viewer nobody |

## Mutants

`PX_MUTANT` plants a defect in the head's output inside the page: `drop-row`,
`swap-order` (across a join-time boundary), `alter-field` (role),
`stale-cache` (the first settled roster, kept across reloads), `skip-live`
(the first settled roster, kept until reload). Each must be reported as
unexplained.
