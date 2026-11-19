## Why

A client that keeps channel messages on the device needs to know, cheaply and
exactly, what changed in a channel since it last looked. Today the only way to
be sure is to refetch the page. This adds a per-channel change sequence: every
committed change to a channel's timeline gets the next number, so a client can
ask "what changed after N" and get a complete, ordered answer, or be told to
start over.

First of a stack: sequence (this PR) -> GraphQL reads -> cache engine -> web.
Nothing reads the sequence until the next PR, and nothing in the app changes
behaviour here except the write path cost described below.

## How it works

```
message / reaction / thread / activity / call-status write
  -> per-parent admission (in process, before a pool connection is taken)
  -> transaction: the write itself
  -> last statement: bump channel_change_counters, insert channel_change_log
  -> commit   (counter row lock is held from the bump to the commit)
  -> push message_update with `seq`
```

- The counter row is locked last, so sequence order is commit order within a
  channel. A reader never sees N+1 before N is visible.
- Changes older than 30 days are pruned. A client further behind than the log
  reaches, or more than 1,000 changes behind, is told to reset.
- Because writers to one channel now queue on one row, a flood on one channel
  could hold pool connections while waiting. Admission caps that: at most 4
  writes per parent are in flight in a process, the rest wait in memory for up
  to 2 s and are then refused with a retryable 503 (`Retry-After: 1`). A 5 s
  lock timeout covers a stalled holder. This guard is a cost of ordering by a
  locked counter; ordering by snapshot would not need it.

## What

- Migration `20261110150956_channel_change_log.sql`: `channel_change_counters`
  (one row per channel) and `channel_change_log`. New tables only, no foreign
  keys, nothing on existing tables.
- `crates/channel_change_db_utils`: append, read-after-sequence, prune.
- `crates/messages`: every channel timeline mutation appends in its own
  transaction; `changes after seq` read; shared per-parent write admission
  used by messages, document comments, activity, calls, imports and agent
  replies; `MessageError::Contended` maps to 503.
- Push: `message_update` events and timeline activities carry `seq`.
- Retention prune is scheduled with the existing outbox job.
- Proof scripts and recorded results under `crates/messages/proofs/`.

### Write path, old against new (same machine, same data)

| | Old | New |
| --- | --- | --- |
| Per-channel ceiling, 2 ms commit hold | 4,076 writes/s | 308 writes/s |
| Per-channel ceiling, 5 ms commit hold | 2,155 writes/s | 157 writes/s |
| 16 writers on one channel, p95 | baseline | +67% to +130% |
| 16 writers on one channel, throughput | baseline | -46% to -58% |
| Neighbour channel at 20/s while another is flooded at 1,000/s and 3,000/s (pool 50, 0/2/5 ms hold) | all succeed | all 7,200 succeed, no pool timeouts, p95 8.4 ms vs 9.0 ms |
| 20 simultaneous posts in one channel | all succeed | all succeed |

Only an API or webhook flood on a single channel reaches the ceiling; the
heaviest real single-channel writers are listed in
`crates/messages/proofs/channel_writer_rates.md`. When it is reached, the
flooding sender gets 503s; everyone else is unaffected (table above).

What a refused sender sees: the web composer shows "Failed to send message" and
restores the draft (no automatic retry); a webhook or API caller gets 503 with
`Retry-After: 1`; an agent reply is retried by its existing retry loop. A
retry with the same client message id does not create a second message.

Known limits: `cleanup_user_call_entities` does not log its deletes;
completing a historical import runs its statements under the counter lock; a
request cancelled after its SQL started can release its admission slot early;
a webhook retried after an unknown outcome is not deduplicated.

## Database review

Deploy order: this PR must be fully rolled out before anything reads the
sequence. A pod still on the old code writes messages without logging them, so
a client syncing during a mixed rollout would miss them. The readers ship in
later PRs of the stack (GraphQL reads, then the web client behind the existing
cache flag), which keeps that window closed as long as they are not deployed
in the same rollout as this one.

| Statement | Fired by | Rows at production size | Relies on | Checked |
| --- | --- | --- | --- | --- |
| `CREATE TABLE channel_change_counters` (fillfactor 70), `channel_change_log`, `CREATE INDEX channel_change_log_created_idx` | deploy | 0, new tables | no lock on existing tables, no foreign keys | by statement |
| Counter bump + log insert | every channel write | 1 upsert, 1 insert | counter pkey, log pkey `(channel_id, seq)`; row lock to commit, 5 s lock timeout | recorded plans, 1.1M log rows, fresh and stale statistics, PG 14 and 18 |
| Activity batch append | activity writes | 1 upsert per channel, 1 insert per activity | counters locked in channel order | recorded plans |
| Changes after seq | change poll | at most `limit` (200) log rows, 2 index probes | log pkey; a client too far behind reads no log rows | < 0.5 ms, <= 23 buffers at 100k rows in one channel |
| Changed-message hydration | change poll | at most 200 ids | `comms_messages_parent_identity`, pkey | 1-3 ms at 2M messages |
| Prune | scheduled, batches of 10,000 | up to 10,000 | `channel_change_log_created_idx` then Tid Scan; 15 s statement timeout | ~6 ms, ~20k buffers at 1M rows (generic, fresh statistics) |
| Reply-root lock (`FOR KEY SHARE`) | reply write | 1 | pkeys | 0.1 ms |

Open finding, justified: the prune depends on the planner choosing a Tid Scan;
the recorded plans show it on both versions and the statement timeout bounds
a flipped plan.

## Follow-ups

- Log the deletes made by `cleanup_user_call_entities`.
