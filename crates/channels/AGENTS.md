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
- `src/domain/access_requests.rs`, `src/domain/service/access_requests.rs`:
  requests to join a private or team channel, answered by any participant.
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
  `POST /channels/{channel_id}/shares` is its HTTP twin (the SDK's `shareWithChannel(channel)` on every shareable handle, through `packages/sdk/src/entities/channels/share.ts`); both take `ChannelShareEntityType` from `domain/models.rs`.
- The channel read tools return `senderName` beside `senderId`: the name the app shows (imported author, bot, call guest, or the person's profile name from `get_user_display_names`). One lookup per call; a failed lookup omits names instead of failing the read.

## Checks

- `cargo test -p channels --all-features` (`SQLX_OFFLINE` unset); the
  repository tests are feature-gated and skipped without it.

## Gotchas

- Deletion is authorized in `ChannelServiceImpl::delete_channel`: the channel
  participant owner may delete it; a team owner/admin may delete only a `team`
  channel whose `team_id` matches their membership. Membership in a channel or
  the channel creator's team never grants deletion authority on its own. Both
  REST deletion and permanent entity deletion call this policy.

- Human DM messages to nonusers use immediate email, including mentions and replies; empty DM creation, bot messages, and silent/mentions-only policies do not trigger this path. Keep registered recipients on their normal notification routes.
- Channel access requests are separate from `crates/access_requests`: access is
  membership, and every participant reviews. Each attempt is its own row so a
  timeline entry keeps its outcome. Approval adds the member in the request's
  transaction, then dispatches `ParticipantsAdded`; the announcement reaches the
  timeline through `macro.channels` and the activity consumer.
  Withdrawal starts the one-minute retry cooldown at `resolved_at`, even when
  the request has been pending longer than a minute.
  Completing a resolved request's notification attempts every recipient before
  returning a recipient update error.

- A person's message shares every item it links; a bot message posted for a
  person (`triggered_by`) shares, as that person, only the linked items the
  sending bot created for them while answering: `created` rows in
  `activity_events` by that bot on the person's behalf since the person's
  latest message in the thread before the reply, falling back to their
  latest message in the channel only when the bot message starts its own
  thread; a reply never falls back (`PgAgentCreations`). The same
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
- Notification filters read `user_notification`'s copied entity columns, never a
  `notification` join: through `notification`, a per-channel check walks every
  user's history on the channel (once ~24% of the prod read replica's buffer
  hits). The channel list seeks `idx_user_notification_viewer_entity` once per
  candidate channel; an array of the user's notified channels reads every
  notification the user has in that state, PR ones included.
- The thread feed's notified roots skip `channel_message_send` rows, which never
  name a thread, so `idx_user_notification_channel_threads` holds only rows
  that can. Web Home sends `(unseen OR seen) AND unseen`;
  `drop_implied_notification_conjuncts` folds that to one notification read.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`

- Capture agent correlation when spawning mutation side effects and restore it when team events create direct-message channels.
