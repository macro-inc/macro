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

- `cargo test -p channels` (`SQLX_OFFLINE` unset).

## Gotchas

- DM invitation emails must stay distinguishable from channel invites (#7964) —
  don't collapse the two email templates.
- Legacy document/CRM/channel message paths were removed (#6732); don't
  reintroduce a parallel message path outside this crate's domain service.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`
