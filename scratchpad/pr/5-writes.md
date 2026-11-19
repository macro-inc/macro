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
