# messages

## What it is

The messaging/discussions feature: anchored discussions on channels and
documents. This domain crate owns the models, authorization, and the
HTTP/Postgres/delivery adapters, feature-gated so callers pull in only what
they need.

## Start here

- `src/domain/models.rs`: shared message/thread models.
- `src/domain/service.rs` + `src/domain/ports.rs`: use-case orchestration and
  the repository/delivery ports (feature `ports`).
- `src/domain/api.rs`: `MessageServiceApi`, the boundary HTTP/agents/channel
  adapters call through.
- `src/inbound/axum_router.rs`: the HTTP surface (feature `inbound`).
- `src/inbound/toolset.rs`: the AI tools for any entity's Discussion
  (`ReadDiscussion`, `Comment`, `EditComment`, `DeleteComment`,
  `ResolveComment`; feature `ai_tools`), addressed by parent kind and id or by
  a thread or comment id alone. `DiscussionParentType::from_parent` is
  exhaustive: a new `MessageParent` variant decides there whether the tools
  address it.
- `src/domain/discussions.rs`: a parent's live threads with all replies, the
  read both `ReadDiscussion` and the document comment reader share.
- `src/domain/service/thread_replies.rs` +
  `src/outbound/pg_message_repo/thread_replies.rs`: one page of a thread's
  replies (see **Thread reply pages**).
- `src/domain/service/guest_chat.rs` + `src/inbound/guest_chat.rs`: live guest
  call discussions; the call domain verifies RTC credentials and membership.
- `src/outbound/pg_message_repo.rs` + `pg_discussion_context.rs`: Postgres
  adapters (feature `outbound`).
- `src/domain/changes.rs` + `src/domain/service/changes.rs` +
  `src/outbound/pg_message_repo/change_log.rs`: a channel's change sequence
  (see **Channel change sequence**).
- `src/outbound/connection_gateway.rs`, `notification_sender.rs`, `broker.rs`:
  realtime/notification delivery adapters (features `outbound`/`broker`).

## Scope

- Owns: message and discussion domain logic, mentions, notification policy
  for messages, and their delivery/storage adapters.
- Not here: channel membership and chat domain logic → `channels`, `chat`;
  who gets notified in general → `model_notifications`.

## Boundaries

- Depends on (by feature): `entity_access` (ports/inbound), `model` (annotations),
  `properties`/`models_properties`/`model_notifications`/`notification`
  (delivery), `initiative` (outbound), `macro_event_broker`/`macro_event_topics`
  (broker).
- Used by: `agent_harness`, `agent_session`, `agent_trigger`, `ai_tools`, `bots`,
  `channel_bots`, `channels`, `coding_agent_worker`, `crm`, `documents`,
  `lexical_client`, `lexical_mention_extractor`, `macro_db_client`,
  `soup_realtime`, `webhook`.

## Recipes

- Add a message use case: `src/domain/ports.rs` (port) → `src/domain/service.rs`
  → `src/domain/api.rs` → `src/inbound/axum_router.rs`.
- Add a delivery channel: `src/domain/delivery.rs` → new adapter under
  `src/outbound/` → feature-gate it in `Cargo.toml`.

## Checks

- `cargo test -p messages --all-features` (`SQLX_OFFLINE` unset).

A finalized bot reply (`NotifyAsPostedMessage` edit by the bot itself) carries
`completed_reply` on its patch event so agent triggers evaluate it like a new
post; streaming updates and ordinary edits never do.

A bot post made for a user through a named client (an MCP client on the public
MCP) uses `MessageAttribution::ActingUserVia`; the client's self-reported name is
stored in `comms_messages.triggered_via` beside `triggered_by`, and clients show
the post as that client's ("Claude Code · Agent · from <user>"). It is a display
label only. Over HTTP the label comes only from the signed `agent_via` claim of
a code-mode token, never from the request body.

New posts use the message sender receipt to retain signed code-mode agent
attribution. All other operations use the caller receipt so attribution cannot
grant users another agent invocation's edit, deletion, or reaction authority.

## Channel change sequence

Every committed change to a channel's messages takes the channel's next
sequence number in the same transaction (`comms_channel_change_counters`) and
leaves a row in `comms_channel_change_log`. `message_update` events carry the
number as `seq`; `MessageService::channel_changes(since)` returns the current
state of everything that changed after a number, or a reset. Other parents
keep no log.

- A new repository write to channel messages calls
  `change_log::append_message` as its last statement before the commit. The
  counter row must be the last lock the transaction takes: a write that takes
  a message lock after it deadlocks with a writer holding that message and
  waiting for the counter. A transaction that inserted a reply calls
  `check_thread_references` first, because the reply's deferred foreign key
  would otherwise lock the root at commit.
- A channel's writes commit one at a time, in two queues. In the process,
  one `write_gate` shared by every repository lets 4 writes per channel hold a
  connection and makes the rest
  wait up to 2 s before a connection is taken, so a burst into one channel
  cannot take the pool from the others. In the database, the append takes the
  channel's advisory lock under a 5 s `lock_timeout`
  (`COUNTER_LOCK_TIMEOUT`), which only a stalled transaction reaches. Either
  wait running out is `MessageError::Busy`: nothing was written, HTTP answers
  503 with `Retry-After`. Every new write path to channel messages enters the
  gate before `pool.begin()`.
- Keep work after the append to the commit: the Slack import still updates
  the channel and its checkpoint after it, and every live writer to that
  channel waits for those statements.
- Sequence numbers follow commit order, so a reader never sees `n` before
  `n - 1`. `concurrent_writers_never_expose_a_gap_to_a_reader` holds this.
- Historical import logs one `HistoryImported` row per batch; readers behind
  it reset. A reader also resets when retention (30 days) removed the change
  after its number, above the counter, or more than `CHANGE_RESET_BACKLOG`
  behind.
- Reads by logged id (`roots_by_ids`, `live_replies`, the activity
  `read_by_ids`) probe the primary key per id behind `OFFSET 0`; a plain join
  or `= ANY` lets a generic plan walk the whole channel.
- Timeline facts (renames, joins) are logged by `ChannelSequencedActivities`
  after the activity store commits them; a replayed batch logs a fact twice
  and readers apply it by id.
- A call's end changes what its root shows but logs only the `call_ended`
  fact; `channel_changes` reloads the root the fact names. A new fact that
  changes how a message reads needs the same.
- `ChannelChangeLogRetention` prunes hourly from `document_storage_service`.

## Thread reply pages

`MessageService::thread_replies` returns one window of a thread's replies in
`get_thread` order, `import_order NULLS LAST, created_at, id`, keyed by a
`ReplyCursor` holding all three, never by offset. A row comparison cannot step
across the NULLs, so every walk reads the imported and the posted part as two
ranges of `idx_comms_messages_thread_order`. A page has a cursor on a side only
when replies exist past it. The walks run with `enable_sort` off, because with
stale statistics the planner sorts the whole thread through another index;
hydration turns it back on. Deleted replies are read and skipped: a walk costs
a buffer per deleted reply it passes.

## Gotchas

- `MessageKind::CallRoot` messages stand for a channel call. Only `ensure_call_root` creates them, and
  they announce themselves with `MessageChange::CallRootPosted`, which reaches viewers and nothing else.
- Most modules are feature-gated (`ai_tools`, `annotations`, `broker`,
  `delivery`, `inbound`, `outbound`, `ports`, `schema`); a caller enabling the wrong
  combination gets a missing-module compile error, not a runtime one — check
  `Cargo.toml`'s `[features]` table before adding a dependency edge.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md` ·
  Skill: `collab-surface-core`
