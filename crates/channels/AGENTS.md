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
  batch name resolution and the SQL name search behind `name_search`
  (`src/outbound/channel_name/match_channel_names.sql`).

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
- Channel-message tools preserve `MessageError::Contended` as an actionable
  retry message and retain its cause internally; never expose database details.
- `EditChannelMessage` and `DeleteChannelMessage` act as the tool's bot only on
  a message that bot posted for the caller (`Message::posted_by_bot_for`), and
  as the caller otherwise; see the receipt rule in `crates/messages/AGENTS.md`.

## Checks

- `cargo test -p channels --all-features` (`SQLX_OFFLINE` unset); the
  repository tests are feature-gated and skipped without it.

## Gotchas

- Deletion is authorized in `ChannelServiceImpl::delete_channel`: the channel
  participant owner may delete it; a team owner/admin may delete only a `team`
  channel whose `team_id` matches their membership. Membership in a channel or
  the channel creator's team never grants deletion authority on its own. Both
  REST deletion and permanent entity deletion call this policy.
  It reads the active members before the delete removes them, and
  `channel.deleted` carries them so `soup_realtime` can drop the channel from
  their open lists.

- `match_channel_names.sql` starts from the viewer's memberships and looks
  every channel, participant, person and bot up by key behind `OFFSET 0`
  fences. Keep that shape: a generic plan estimates every viewer at a few
  memberships, and the earlier CTE version then joined its matches back to the
  viewer's channels in a nested loop, seconds for a viewer in thousands of
  channels. Its plan test runs custom and generic plans.

- `historical::find_dm` (get-or-create, the read-only
  `ChannelService::find_direct_message`, the Slack importer) intersects the two
  people's participant rows behind an `OFFSET 0` fence, through the partial
  `(user_id, channel_id)` indexes on active rows and on left rows
  (`idx_comms_cp_left_by_user_channel`), then reads the rows of each shared
  direct message once. A DM has rows of exactly the two of them, active or
  left: an imported DM both people left is still the one to reuse. A third
  member still in it (a bot) makes it a group. The Slack importer
  (`DmRoster::Stored`) counts every row and takes the oldest, then the lowest
  id, the rule it reserved its channels by. Live get-or-create
  (`DmRoster::Listed`) and the lookup (`DmRoster::Joined`) also take a DM
  both people are still in whose other rows are members who left (a removed
  bot, a person who left a legacy group), as channel lists show it. Once one
  of the two has left, every row counts again, as before: reuse rejoins
  nobody, so such a DM would take a first message its sender cannot post or
  the other person never sees. Of several DMs, live get-or-create takes one
  both people are still in, then one only the other left, then one its actor
  left, then one both left; then the oldest, then the lowest id, so a legacy
  duplicate never takes over the DM in use. The lookup ranks the same among
  the DMs its viewer is still in: it answers the DM their first message would
  reuse whenever they can open it, and nothing otherwise. Unlike the web
  opener it replaces, which read the channel list and found only a DM both
  people were in, that includes one only the other person left, which
  get-or-create already reused. So when a pair's only DM had a bot removed,
  a Slack import of that pair creates a DM of its own while live messages
  keep reusing the first. Keep that shape; checking every direct-message
  channel for both people reads the whole table.

- The channel list picks its candidates from the filter
  (`ChannelCandidates::for_filter`): joined channels by default, plus the
  user's team channels when the filter mentions `IsParticipant`, plus public
  channels when it also names only channels by id (the soup item loader's
  by-id read). The by-id read looks activity up per named channel behind an
  `OFFSET 0` fence and runs under a 15 s statement timeout, since its cost
  follows the ids a client sends.

- A list page takes each listed channel's viewed and interacted times from
  that channel's own activity row (`get_channel_activities`, one fenced probe
  per id). The SQL sorted the page on them, and Soup and REST build the next
  cursor from them: a channel left without its row moves the cursor, and the
  next page skips channels. `get_channel_list_activities` (the user's latest
  100) is only the legacy `/activity` read.
  `ChannelService::channel_viewed_at` reads one row of that table by its
  unique `(user_id, channel_id)` key, with no access check: it is the
  caller's own row, kept after they leave the channel.

- Human DM messages to nonusers use immediate email, including mentions and replies; empty DM creation, bot messages, and silent/mentions-only policies do not trigger this path. Keep registered recipients on their normal notification routes.
- A person's first top-level message with the default notification policy invites the channel's recipients who are not mentioned in it. In a DM or unnamed group chat (`ChannelMetadata::is_dm_or_group_chat`) that message creates the conversation, so those recipients with an account get the ordinary channel message notification instead, which counts as unread; only people without an account get the invite. Bot first messages and mentions-only posts never invite.
- Channel access requests are separate from `crates/access_requests`: access is
  membership, and every participant reviews. Each attempt is its own row so a
  timeline entry keeps its outcome. Approval adds the member in the request's
  transaction, then dispatches `ParticipantsAdded`; the announcement reaches the
  timeline through `macro.channels` and the activity consumer.
  The announcement stores the requester's profile name as it was when they asked
  (`requester_name`, optional), so the timeline entry mounts at its final height;
  the web app swaps in the current name once it loads.
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
- Side effects record who "interacted on Macro" (`interactions_for_event` in
  `domain/side_effects.rs`, `ChannelContactsDispatcher::record_interactions`):
  creating a non-DM channel pairs everyone in it unless the Macro system bot
  created it (the signup support channel), and an add, a join, an approved
  request or a team auto-join pairs the newcomers with every active member.
  A DM counts only from a person's message in it, never from its creation,
  since Macro opens teammate and inbox DMs on its own; bot and guest posts
  never count, and nothing else posted in a channel does. The two team
  auto-join paths (`auto_join_by_team_id`, turning auto-join on in
  `patch_channel`) dispatch `MembersAutoJoined`, which only feeds contacts.
  Every host wraps the contacts ingress in `contacts::domain::list_writes::ListWritesGate`,
  so these sends wait for the `contacts-list-writes` flag; the legacy
  `enqueue_contacts` sync is unchanged.
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

- CRM attachment-reference lookups authorize the referenced company/contact/pipeline through the comment-parent access port before reading references; a missing adapter or denied target returns no references.
