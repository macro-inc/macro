## Why

Channel messages are read over REST and never reach the device cache, so a
channel always opens from the network. To keep them on the device the cache
needs the same rows through GraphQL, with stable keys, a sort key the device
can order by, and a way to replay what changed.

Second of a stack: sequence -> GraphQL reads (this PR) -> cache engine -> web.
No client calls these fields yet.

Stacked on the sequence PR so the diff shows only this layer. `CI gate` has
not run on this PR: CI runs only for PRs based on main. It is covered by the
run on the top of the stack (#10441), whose diff contains this one, and gets
its own gate when retargeted to main at merge time.

## How it works

Four fields on the signed-in user, all backed by the existing message service
and its permission checks:

- `channelTimeline(channelId, limit, before | after | around)`: one page of
  roots and timeline activities with cursors and the channel's sequence at
  read time.
- `channelThread(channelId, rootId, limit, before | after | around)`: one
  bounded page of a thread's replies.
- `channelChanges(channelId, after, limit)`: changes after a sequence, at most
  200 per page; `resetRequired` when the client is more than 1,000 behind or
  past retention.
- `channelMessage(channelId, messageId)`: one message, for going to a
  location.

## What

- `crates/graphql_channel`: schema types, inputs, authenticated adapters.
- `crates/messages`: bounded thread reads (`thread_older.sql`,
  `thread_newer.sql`) and seek cursors for the timeline queries.
- Timestamps and optional fields are formatted exactly as the REST message
  API formats them.
- `static_assets/schema.graphql` and `.sqlx` metadata regenerated.

### Equality with REST

Read through both APIs on the same stack and compared row for row with no
normalisation: channels of 38, 1,490 and 5,950 rows (1, 16 and 60 pages), 4
windows around a message, 4 newer-than windows, and 15 threads up to 250
replies. All equal. A GraphQL page costs about 0.8 ms more on the server than
the REST page; a long thread is several bounded requests where REST is one.

## Database review

| Query | Fired by | Rows at production size | Relies on | Checked |
| --- | --- | --- | --- | --- |
| `thread_older.sql`, `thread_newer.sql` | `channelThread`, 1-3 per request | at most limit+1 (101) keys per bucket; nothing scales with channel size | `idx_comms_messages_thread_order`, `comms_messages_parent_identity`, pkey | `EXPLAIN (ANALYZE, BUFFERS)`, generic plan: 0.73-0.87 ms, ~810 buffers for 101 rows of a 250-reply thread, no Seq Scan |
| Thread root, `around` anchor | `channelThread`, `channelMessage` | 1 | `comms_messages_pkey` | index |
| Timeline older / newer with seek cursor | `channelTimeline` and existing callers | 51 roots per page among ~40,000 in the test data; 161-172 buffers | `idx_comms_messages_parent_timeline`, `comms_message_threads_pkey`, `idx_comms_messages_thread_active_created` | generic and custom plans, with and without cursor; the cursor is an index condition |
| `channelChanges` | change poll | existing queries from the sequence PR | unchanged | reasoned |

No findings to fix. Not measured: the imported-reply bucket (same index and
shape, no imported rows in the test data) and a thread whose replies are
mostly deleted (bounded by thread size and a 15 s statement timeout).
