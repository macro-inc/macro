# chat

## What it is

Part of AI chat: chats and chat messages, persistence, HTTP/toolset
adapters, and lifecycle events. See `README.md` for the Kafka event schema.

## Start here

- `src/domain.rs`: `ChatService`/`MessageService` — chat and message CRUD,
  copy, revert-delete, and project bookkeeping.
- `src/domain/events.rs`: `chat.*`/`chat.message_*` events published to
  `macro.chats` (schema in `README.md`).
- `src/inbound/attachment.rs`: the `AttachmentService` impl for chat messages.
- `src/inbound/toolset.rs`: AI tools over chats (feature `ai_tools`).
- `src/outbound/postgres.rs`: storage (feature `outbound`).
- `PLAN.md`: in-progress plan for user-level resolved attachments — check its
  "What's Broken" section before assuming it's finished.

## Scope

- Owns: the `Chat`/`ChatMessage` tables, chat sharing/ownership, and message
  send/store/delete.
- Not here: channel messages → `crates/channels`; model selection and provider
  calls → `crates/agent`.

## Boundaries

- Depends on: `attachment` (feature `attachment`), `entity_access_db_utils`,
  `share_permission_db_utils`, `macro_uuid`.
- Used by: `ai_tools`, `agent_inmem`, `soup_realtime`.

## Recipes

- Add a chat/message field or mutation: `src/domain.rs` → `src/outbound/postgres.rs`
  → `src/inbound/mod.rs` (router) → emit/update the matching event in
  `src/domain/events.rs`.

## Checks

- `cargo test -p chat` (`SQLX_OFFLINE` unset).

## Gotchas

- Kafka events key on the chat's bare UUID (no `chat|` prefix); `chat.updated`
  metadata describes the requested PATCH — an omitted field serializes as
  `null`, and `project_id: ""` means "removed from its project" (see `README.md`).
- Sharing a chat with a team is gated through `SharePermission.team_share_*` and
  only the persisted owner may set `teamShareAccessLevel`.
- `FREE_MODEL` is published as the `FreeTierModel` OpenAPI schema; the web
  client's free tier is generated from it. After changing it, run
  `bun run gen-api document-cognition` in `apps/web`, update the web model
  catalog if the id is new, and keep `ai_projections::FREE_TIER_MODELS` equal
  (`document_cognition_service` tests both).

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/observability.md`
