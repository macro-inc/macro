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
- `src/domain/changes.rs` + `src/domain/service/changes.rs`: authorized channel
  catch-up pages and 30-day change-log retention; `channel_changes` includes
  tombstones and the root of each changed reply, with 200 log rows per page.
- `crates/channel_change_db_utils`: owns counter/log SQL; message adapters pass
  transaction boundaries and policy limits to it, then map rows to domain types.
  DSS composes atomic activity logging; the call repository appends root changes.
- `src/domain/api.rs`: `MessageServiceApi`, the boundary HTTP/agents/channel
  adapters call through; `thread_page` adds bounded reply windows while
  `get_thread` preserves the complete REST thread read.
- `src/inbound/axum_router.rs`: the HTTP surface (feature `inbound`).
- `src/inbound/toolset.rs`: the AI tools for any entity's Discussion
  (`ReadDiscussion`, `Comment`, `EditComment`, `DeleteComment`,
  `ResolveComment`; feature `ai_tools`), addressed by parent kind and id or by
  a thread or comment id alone. `DiscussionParentType::from_parent` is
  exhaustive: a new `MessageParent` variant decides there whether the tools
  address it.
- `src/domain/discussions.rs`: a parent's live threads with all replies, the
  read both `ReadDiscussion` and the document comment reader share.
- `src/domain/service/guest_chat.rs` + `src/inbound/guest_chat.rs`: live guest
  call discussions; the call domain verifies RTC credentials and membership.
- `src/outbound/pg_message_repo.rs` + `pg_discussion_context.rs`: Postgres
  adapters (feature `outbound`); `pg_message_repo/thread.rs` pages replies
  by `(import_order NULLS LAST, created_at, id)` using the thread-order index.
- `src/outbound/pg_message_repo/write_hydration.rs`: channel writes hydrate in
  one indexed statement (plus a bot lookup when needed); other parents keep
  their existing statements.
- `src/outbound/pg_message_repo/change_log.rs`: append channel changes as the
  final statement before commit; other message parents run no extra statements.
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
  (delivery), `initiative` and `channel_change_db_utils` (outbound), `activity` models,
  `macro_event_broker`/`macro_event_topics` (broker).
- Used by: `agent_harness`, `agent_session`, `agent_trigger`, `ai_tools`, `bots`,
  `calendar_service`, `call`, `channel_bots`, `channels`, `coding_agent_worker`,
  `crm`, `documents`,
  `lexical_client`, `lexical_mention_extractor`, `macro_db_client`,
  `soup_realtime`, `webhook`.

## Recipes

- Add a message use case: `src/domain/ports.rs` (port) → `src/domain/service.rs`
  → `src/domain/api.rs` → `src/inbound/axum_router.rs`.
- Add a delivery channel: `src/domain/delivery.rs` → new adapter under
  `src/outbound/` → feature-gate it in `Cargo.toml`.

## Checks

- `cargo test -p messages --all-features` (`SQLX_OFFLINE` unset).
- `proofs/README.md`: reproducible local query plans for the channel change log,
  hydration, retention, and writes on production-size synthetic fixtures.

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

## Gotchas

- Acquire process-wide parent admission before a message write takes a database
  connection; retain the permit through commit. The shared gate admits four
  writes per `(entity type, id)` and rejects a two-second wait as retryable
  `MessageError::Contended`. Caller-owned transactions acquire admission first.
  Channel counter appends retain a five-second lock-timeout guard; ordinary
  statement cancellation remains a repository error.
- Channel change rows retain 30 days of history; the calendar outbox worker
  runs their bounded hourly prune even when calendar sync is disabled. Changes
  pages cover 200 rows; a pruned position, a reset row, or a lag over 1,000
  requires a fresh snapshot. Realtime pushes carry the committed sequence.
- `MessageKind::CallRoot` messages stand for a channel call. Only `ensure_call_root` creates them, and
  they announce themselves with `MessageChange::CallRootPosted`, which reaches viewers and nothing else.
- Channel change-log rows and their counters are read in one snapshot; retention
  removes a prefix, so the first retained sequence minus one is the resume floor.
  Keep counters after pruning so sequence numbers are never reused.
- A call chat's first message is a normal `MessageKind::Message` root; deleting it tombstones only
  that message and keeps the thread and replies available for later posts.
- Most modules are feature-gated (`ai_tools`, `annotations`, `broker`,
  `delivery`, `inbound`, `outbound`, `ports`, `schema`); a caller enabling the wrong
  combination gets a missing-module compile error, not a runtime one — check
  `Cargo.toml`'s `[features]` table before adding a dependency edge.

- Thread summaries count live replies on each page. With stale statistics after a
  very large import, an ordinary-reply page can also scan that thread's imported
  prefix; keep this cost visible when changing the thread queries.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md` ·
  Skill: `collab-surface-core`
