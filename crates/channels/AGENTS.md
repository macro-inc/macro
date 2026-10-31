# channels

## What it is

Part of Chat: paginated channel messages — threads, reactions, attachments,
DMs, and the shared message store other domains discuss things on.

## Start here

- `src/domain/service.rs`, `src/domain/models.rs`: channel/message CRUD and policy.
- `src/domain/message_delivery.rs`, `src/domain/broker_events.rs`: realtime
  fan-out of new messages to connection gateway.
- `src/domain/dm.rs`, `src/domain/teammate_dms.rs`: direct-message channels.
- `src/domain/reference_sharing.rs`: sharing an external item (PDF, doc, CRM
  record) into a channel.
- `src/inbound/attachment.rs`: the `AttachmentService` impl for channel messages.
- `src/inbound/toolset.rs`: AI tools over channels (feature `ai_tools`).
- `src/outbound/pg_channels_repo.rs`, `src/outbound/connection_gateway_realtime.rs`:
  storage and realtime delivery adapters.
- `src/outbound/channel_name.rs`: the viewer-dependent channel naming rule —
  batch name resolution and the SQL name search behind `name_search`.

## Scope

- Owns: channels, channel messages, threads, reactions, DMs, and message-level
  attachment/reference sharing.
- Not here: channel labels → `crates/channel_labels`; calls/video →
  `crates/call`; built-in agent triggers → `crates/channel_bots`.

## Boundaries

- Depends on: `entity_access`, `macro_authorization`, `attachment` (feature
  `attachment`), `model-entity`.
- Used by: widely — `bots`, `call`, `teams`, `webhook`, `soup`/`soup_realtime`,
  `agent_harness`, `agent_trigger`, `coding_agent_worker`, `comms_db_client`,
  `graphql_channel`, `search_service`, `name_search`, `ai_tools`, `memory`.
  Check callers before changing a public service method's signature.

## Recipes

- Add a message field or mutation: `src/domain/models.rs` → `src/domain/service.rs`
  → `src/outbound/pg_channels_repo.rs` → `src/inbound/axum_router.rs`.
- Change realtime delivery: `src/domain/message_delivery.rs` →
  `src/outbound/connection_gateway_realtime.rs`.
- Add a channel-message AI tool: `src/inbound/toolset.rs` (feature `ai_tools`).

## Tool contracts

- `ShareWithChannel` exposes agent sessions and omits legacy chat targets; the domain retains historical entity support.
- The channel read tools return `senderName` beside `senderId`: the name the app shows (imported author, bot, call guest, or the person's profile name from `get_user_display_names`). One lookup per call; a failed lookup omits names instead of failing the read.

## Checks

- `cargo test -p channels --all-features` (`SQLX_OFFLINE` unset); the
  repository tests are feature-gated and skipped without it.

## Gotchas

- Human DM messages to nonusers use immediate email, including mentions and replies; empty DM creation, bot messages, and silent/mentions-only policies do not trigger this path. Keep registered recipients on their normal notification routes.

- A person's message shares every item it links; a bot message posted for a
  person (`triggered_by`) shares, as that person, only the linked items the
  sending bot created for them while answering: `created` rows in
  `activity_events` by that bot on the person's behalf since the person's
  latest message in the thread before the reply (`PgAgentCreations`). The same
  bound covers classic `@Macro` and agent session turns. Activity lands asynchronously, so misses are
  re-checked after 5 s and 30 s in a spawned task. Creations recorded under
  another bot (`MACRO_AI_BOT_ID` for Claude/Codex/Cursor MCP tools) or the
  user (projects, chats, calls) never match, and fail safe as unshared.
- DM invitation emails must stay distinguishable from channel invites (#7964) —
  don't collapse the two email templates.
- Legacy document/CRM/channel message paths were removed (#6732); don't
  reintroduce a parallel message path outside this crate's domain service.
- Attachment references from comments (messages on documents, initiatives, CRM
  records, calls) are authorized in `ChannelServiceImpl::get_attachment_references`
  through the `CommentParentAccess` port; the repo returns every parent. A
  service built without `with_comment_parent_access` withholds them.
- The channel list's unseen/seen filter matches a set built once from the
  user's notifications (`= ANY(ARRAY(...))`). A per-channel `EXISTS` or plain
  `IN` walks every candidate channel's notification history; that was ~24% of
  the prod read replica's buffer hits.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`
