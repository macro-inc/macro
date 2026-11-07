# channels_inbound

## What it is

Part of Chat: the inbound adapters for `channels`. The channel-message and
access-request HTTP routes (feature `axum`, plus `list` for the legacy list
routes), the AI toolset (`ai_tools`), the `AttachmentService` for channel
messages (`attachment`), and the teammate-DM Kafka consumer
(`kafka_consumer`).

## Start here

- `src/axum_router.rs`: routes and router state; `axum_router/` holds one file
  per resource.
- `src/toolset.rs`: AI tools over channels.
- `src/attachment.rs`: renders channel references as AI attachments.
- `src/teammate_dms_consumer.rs`: ensures teammate DMs on `team.member_joined`.

## Boundaries

- Depends on: `channels` (domain), `entity_access`, `macro_authorization`.
- Used by: `ai_tools`, `services/document_storage_service`,
  `services/agent_harness_service`.

## Tool contracts

- `ShareWithChannel` exposes agent sessions and omits legacy chat targets; the domain retains historical entity support.
  `POST /channels/{channel_id}/shares` is its HTTP twin (the SDK's `CalendarEvent.shareWithChannel`); both take `ChannelShareEntityType` from `domain/models.rs`.
- The channel read tools return `senderName` beside `senderId`: the name the app shows (imported author, bot, call guest, or the person's profile name from `get_user_display_names`). One lookup per call; a failed lookup omits names instead of failing the read.

## Checks

- `cargo test -p channels_inbound --all-features`
