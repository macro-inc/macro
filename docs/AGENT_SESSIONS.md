# Agent sessions

How a channel mention becomes a sandboxed coding agent, and why the pieces are
shaped the way they are.

This replaces `agent_proxy`, which proxied agent traffic into chat. Agent
sessions now persist their own ACP transcript and nothing proxies to chat.

## The crates

| crate | job |
|---|---|
| `agent_runtime_protocol` | the `agent-runtime.v0` wire envelope, the transport port, `AcpId`, `AgentAction` |
| `agent_session` | the `agent_session` / `agent_session_log` rows and their ports |
| `agent_trigger` | watches channel messages, decides, emits signals to Kafka |
| `agent_harness` | owns the session state machine and the ACP handshake |

Dependencies run `agent_harness → agent_trigger → agent_session → agent_runtime_protocol`.
The trigger owns the signal schema because it produces it, matching how
`channels` owns `ChannelMacroEvent`.

## The flow

```
channel message
  → agent_trigger        find_for_thread, then yield an event
  → macro.agent_sessions
  → agent_harness        create-or-resume, spawn a container, plug it in
  → AgentSession         queue, handshake, flush
  → the agent
```

The split exists so the expensive half only wakes on real work: a wrong
decision in the trigger costs a Kafka message, not a Daytona sandbox.

## Three surfaces

A session touches three places, and conflating them caused most of the
confusion while designing this.

| # | what | comms identity | on `AgentSession` |
|---|---|---|---|
| 1 | the channel | `channel_id` | not stored |
| 2 | the thread the bot replied in - ping it to get a response | root message id | `created_from_thread_id` |
| 3 | the dedicated orphaned thread - every message goes to the agent | root message id | `thread_id` |

**A thread is a message.** There is no thread entity; a thread is identified by
its root message's id, and `ResolvedChannelMessage.thread_id` "equals
`message_id` for top-level messages". So a message normalizes to a thread with
`thread_id.unwrap_or(message_id)`, and a top-level mention names the thread the
agent's own reply is about to root.

`AgentSessionRepo::create` mints #3, so it never appears on an inbound signal.

## The trigger's rule

`agent_trigger::domain` holds it as a pure function - no I/O, so the caller does
the `find_for_thread` lookup and the rule needs no mocks to test.

| sender | `ThreadSession` | mentions us | → |
|---|---|---|---|
| **our bot** | any | any | **ignore** |
| user | `InSessionThread` | **any** | feed it, `DedicatedThread` |
| user | `CreatedFromThisThread` | yes | feed it, `MentionThread` |
| user | `None` | yes | open a session |
| user | anything else | no | ignore |

Two rows carry the weight:

- **Ignoring our own bot is rule zero.** The agent replies into its own thread,
  so reacting to that reply feeds it back to itself forever - with a sandbox
  attached.
- **The dedicated thread needs no mention.** Nobody `@`s a bot in its own
  session thread; that is what makes it dedicated.

`find_for_thread` answers both "does a session exist" and "which of its two
threads matched" in one query, and `ChannelKind` maps straight onto the result
rather than being re-derived:

```sql
WHERE bot_id = $1 AND (created_from_thread_id = $2 OR thread_id = $2)
```

Mention matching itself is `channels::domain::side_effects::bot_mention_ids`,
not reimplemented here - the `bot|<uuid>` form and the user-tagged-bot quirk
stay owned by `channels`.

## The session state machine

`agent_harness::domain::agent_sessions::AgentSession` is `&mut self` with no
locks, no channels and no spawned tasks, so a test drives it one message at a
time through `step()` and no pump runs.

```rust
enum SessionState {
    Booting,
    Handshaking { opened: RequestId },
    Live { acp: AcpId },
    Dead,
}
```

**Ready means handshakeable, not sendable.** The container reports
`SystemEvent::AcpReady` when its agent process is wired up, but a
session-scoped ACP request needs the `AcpId` that only `session/new` returns.
So actions queue through both `Booting` *and* `Handshaking`, and flush only
once the ACP session exists. That gap is the bug this shape exists to prevent.

`initialize` and `session/new` go out together rather than sequentially, and the
id of the `session/new` is remembered in `Handshaking` so its answer is
recognisable - no reserved or well-known request ids.

**The queue lives outside `SessionState`.** A flush that fails part-way has to
leave the remainder queued, and it cannot if the buffer is dropped with the old
state. So `pending: VecDeque<PendingAction>` is its own field, drained by
peeking and popping only after a send succeeds:

```rust
while let Some(queued) = self.pending.front().cloned() {
    let message = queued.action.to_runtime(acp, self.next_id())?;
    self.send_now(queued.from, message).await?;
    self.pending.pop_front();
}
```

Sending while `Live` flushes first, so a new action cannot overtake a stranded
one - which also makes recovery automatic instead of needing a retry path.

A refused `session/new` transitions to `Dead` rather than leaving the session
wedged in `Handshaking` with a live connector and a queue nobody will drain.

### Who asked

`PendingAction` carries the user id alongside the action, because who asked is
only knowable when the action arrives - by the time it reaches the wire the
request is long finished. That id lands on `AgentSessionLog.user_id`, so a
prompt queued during a sandbox boot is still attributed correctly.

### Ports

- `AgentConnector` - a live link carrying one session's envelope traffic. The
  session talks only to this, never to a container, so a container someone else
  spawns and dials into us later reuses the buffering and handshake unchanged.
- `Container: AgentConnector` - adds only the sandbox identity needed to
  reattach. `ContainerId` derives from `AgentSessionId`, so reattaching needs no
  stored mapping.
- `AgentSessionManager` - mints rows and plugs links into sessions. Knows
  nothing about containers: a row must exist before anything can be provisioned
  for it, since the link is named after the session. So `create` → (someone
  provisions) → `plug`, which is the seam the provisioning crate slots into.

## Using the ACP library

Types come from `agent-client-protocol` throughout - `InitializeRequest`,
`NewSessionRequest`, `NewSessionResponse`, `ClientRequest`, `ContentBlock` - and
`JsonRpcMessage::to_untyped_message()` does the serialization with the method
name attached, so **no ACP method name is written by hand anywhere in the
workspace**.

Its *connection* machinery is deliberately not used. `ConnectionTo::build_session(cwd).start_session()`
would perform the handshake for us, but it needs an envelope demux, a tee so the
log still sees every raw frame, and spawned actors - which costs the
deterministic `step()` the tests depend on. The thing that should tip that
decision later is **cancellation**: `session/cancel` plus cancelling an in-flight
prompt is real machinery the library already has, and hand-rolling it would be a
worse trade than hand-rolling a two-request handshake. At that point adopt the
connection wholesale rather than piecemeal.

## Test doubles

In `agent_harness::testing::helpers`, all sync, no async trickery:

- **`FakeAgent`** - the agent process. Speaks raw ACP only, like the real
  sidecar, and **panics if the harness speaks out of ACP order** - a
  session-scoped request before its session exists, or `session/new` before
  `initialize`. That check caught a prompt being sent as a notification.
  `completes_initialize` / `opens_session` / `refuses_session` answer the request
  it actually received, so tests never name a request id.
- **`ContainerMock`** - the envelope boundary: wraps raw frames, originates
  lifecycle events. `recv` awaits rather than reporting an empty queue as a
  closed stream, so a forgotten enqueue hangs (pointing at the missing call)
  instead of looking like a dead container. `fails_sends_after(n)` injects
  transport failure.
- **`MockContainerManager`** - remembers what it spawned, so `resume` returns the
  *same* container. That is the Daytona state-preservation property, asserted.
- **`LogRepoMock`** - the log in memory.

`agent_session` exposes `MockAgentSessionRepo` behind a `test-utils` feature,
following `crates/frecency`'s pattern - `cfg(test)` alone cannot reach
downstream test crates.

### Mutation testing

Every behaviour claimed above was verified by breaking the source and confirming
a test fails. Caught: dropping a queued action, never draining the queue,
firing the handshake on any event instead of `AcpReady`, ignoring the remembered
request id, losing user attribution on flush, `mem::take` instead of
peek-then-pop, no `Dead` on refusal, no flush-before-send, removing the own-bot
guard, requiring a mention in the dedicated thread.

One of those found a real hole: the original integration test passed with the
`AcpReady` gate removed entirely, because it only ever sent `AcpReady`. Another
found an assertion that had silently never been inserted, because `cargo fmt`
reflowed the line it was patched against.

## Deliberately not done yet

- **Nothing is wired.** No production caller for any of it; the harness service
  is a stub that loads config and exits. So every assumption is unvalidated:
  whether the real sidecar emits `AcpReady`, whether pipelining `initialize` and
  `session/new` works against opencode, whether `/workspace` is right.
- **`acp_session_id` is never persisted.** The session exposes `acp_id()` and the
  hook belongs where it goes `Live`, but writing it needs
  `AgentSessionRepo::set_acp_session_id`, which means new SQL and a
  `prepare_db` run.
- **ACP-level resume is unimplemented.** Container resume works and is tested,
  but `session/load` is not wired, so a resumed session mints a fresh ACP
  session and the agent starts without the earlier conversation.
- **`agent_proxy`'s deployed footprint survives its code**: the Pulumi stack and
  Doppler project, the applied `agent_proxy_pending_message` migration, the SDK's
  `agent-proxy` entry, and its generated web client.

## Open questions

**Do messages in an orphaned thread reach `macro.channels`?**
`ChannelMessagePostedMetadata.channel_id` is not `Option`. If the dedicated
thread is genuinely disconnected from any channel, those messages may not be
published at all - and the dedicated-thread rule would never fire in production
despite being tested. This needs checking in the comms write path before the
trigger's Kafka loop is built.

**`find_for_thread` runs on every message in the firehose**, and it cannot be
skipped for un-mentioned messages because that is exactly the dedicated-thread
case. Nothing indexes `created_from_thread_id` today, so the query does a bitmap
OR with a slow half. The escape hatch later is caching the set of live session
thread ids, but a stale cache silently drops messages.

**Dedup is the harness's job.** Kafka is at-least-once and both side effects - a
sandbox and a channel reply - are expensive and user-visible, so the harness must
dedupe on `message_id` before acting. `crates/task_dedup` exists for it.

**Two `AgentSession`s and two `SessionStatus`es.** `agent_session::domain::model`
exports the persisted row and its status; `agent_harness` has a live session and
its own status. They are aliased at import today, which does not scale past a
couple of call sites.

**Embedding `ChannelMessagePostedMetadata` couples the schemas.** Signals carry
the triggering message verbatim, which is convenient and race-free, but our
topic's wire format now changes whenever `channels` changes theirs and nothing
forces `SCHEMA_VERSION` to bump. A shape-pinning test would make that fail our
build instead of production.
