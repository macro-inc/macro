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

## Checks

- `cargo test -p channels --all-features` (`SQLX_OFFLINE` unset); default features
  do not execute the mutation service or provider lifecycle guard tests.

## Gotchas

- DM invitation emails must stay distinguishable from channel invites (#7964) —
  don't collapse the two email templates.
- Legacy document/CRM/channel message paths were removed (#6732); don't
  reintroduce a parallel message path outside this crate's domain service.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`

The notification port accepts external display names and an optional stable source ID
for recovered channel-message notifications. Ordinary posts retain fresh IDs. Callers
select authorized recipients; this port does not invoke human-post agent triggers.

## Provider-managed groups

`ChannelInfo.messaging_binding` is set atomically for direct bindings and group setup;
channel detail, lists and GraphQL expose the same enum. Native detail reads require
view access, including public and unjoined team viewers; mutation role checks stay separate. The domain blocks
local name/visibility mutations and fails generic deletion closed for these channels; provider-owned explicit deletion
revalidates human authority and synchronizes through native teardown. DSS uses explicit human-authorized messaging deletion, so its generic native
delete remains fail closed for groups. Private-chat reuse selects only native bindings, excluding every external conversation. `pg_channels_repo/provider.rs` owns transactional provider
subject changes; DSS publishes the returned ordinary channel event.

## Personal WhatsApp linked devices

Personal `whatsapp_linked_group` bindings preserve native access and block generic provider mutations/calls. Participant, preview, thread and list queries gate current linked audiences behind the native marker. Remote membership never creates native grants; local detach never deletes a remote group. See `docs/WHATSAPP_LINKED_DEVICES.md`.
