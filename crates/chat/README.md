# Chat crate

This crate owns AI chat models, persistence ports, service policy, and the
HTTP and toolset adapters for chats and chat messages. The chat and message
services also produce sanitized lifecycle and message events for successful
chat mutations.

## Chat event producer

The events below use schema version 1 and are published to the `macro.chats`
Kafka topic. Every record uses the subject chat's bare UUID string as its
Kafka key (for example, `3f6f8b0a-6f9f-4a3f-9c3a-2b1e5d4c7a90`, without a
`chat|` prefix). The key is not part of the JSON envelope. Events for one chat
therefore use the same Kafka partition and retain per-chat ordering; ordering
between different chats is unspecified.

| Event name | Emitted after | Metadata |
| --- | --- | --- |
| `chat.created` | `ChatService::create` and its project bookkeeping succeed; also emitted by the DCS streaming flow when sending a message implicitly creates a chat | `chat_id`, `owner`, `name`, `project_id` |
| `chat.updated` | A chat PATCH (`ChatService::patch`) is persisted | `chat_id`, `actor_user_id`, requested `name`, `previous_project_id`, requested `project_id`, `share_permission_updated` |
| `chat.deleted` | Soft deletion succeeds | `chat_id`, `actor_user_id`, `project_id` |
| `chat.permanently_deleted` | Permanent deletion succeeds | `chat_id`, `actor_user_id`, `project_id` |
| `chat.restored` | `ChatService::revert_delete` succeeds | `chat_id`, `actor_user_id`, `project_id` |
| `chat.copied` | `ChatService::copy_chat` succeeds | `chat_id` (the new copy), `source_chat_id`, `owner`, `name` |
| `chat.message_sent` | `MessageService::create` (user message) or `MessageService::store` (assistant message) persists the message | `chat_id`, `message_id`, `role`, `model`, `actor_user_id`, `attachment_count` |

Optional metadata is serialized as `null`. On `chat.updated`, `name` and
`project_id` describe the requested PATCH: `null` means the field was omitted,
and `project_id: ""` means the chat was removed from its project (mirroring
the `PatchChatArgs` semantics). `previous_project_id` is the project in the
pre-PATCH chat snapshot when known. On the deleted, permanently-deleted, and
restored events, `actor_user_id` is `null` for unauthenticated or internal
callers.

`role` on `chat.message_sent` is lowercase (`user`, `assistant`, or `system`)
and distinguishes user messages from assistant messages. `actor_user_id` is
the sender for user messages and `null` for assistant messages. `chat.copied`
is keyed by the new chat's id; `chat.message_sent` is keyed by the parent
chat's id, preserving per-chat ordering.

## Sanitization

Event payloads exclude message content and attachment content; the only
attachment-derived value is the `attachment_count` field on `chat.message_sent`.
Share-permission payloads are also excluded: a PATCH that changes share
permissions is represented only by the `share_permission_updated: bool` flag
on `chat.updated`.

## Excluded flows and known gaps

Only the successful mutations in the table produce these events. Read/list
operations and tool-call mutations emit nothing. Message update and delete
operations and tool events (for example `chat.tool_called` and
`chat.tool_rejected`) are not yet produced; they can be added later as new
enum variants.

The AI auto-rename flow
(`services/document_cognition_service/src/service/chat_renamer.rs`) patches
via `PgChatRepo` directly and does not emit `chat.updated`.

Only the document cognition service (DCS) HTTP chat router, the DCS
stream-side implicit chat creation, and the DCS `MessageServiceImpl` publish
to Kafka. The `ChatServiceImpl` instances in mcp_service, memory, and
ai_tools agent contexts and in the DCS chat tool context use the
`NoopMacroEventBroker` default and do not publish.

This crate provides production only; it adds no chat-event consumer.

## Delivery semantics and compatibility

Publication occurs after the relevant committed mutation and is
fire-and-forget. The API does not wait for Kafka delivery, and a scheduling or
publication failure is logged without rolling back or failing an otherwise
successful request. There is no transaction, outbox, or retry coupling
database persistence to publication. Delivery is therefore at-most-once
relative to chat mutations: a committed mutation can have no corresponding
event.

Consumers must tolerate unknown `event_type` values and unknown metadata
fields so new event variants and additive fields remain forward compatible.
Consumers should use `schema_version` when interpreting a known event; every
event in this contract currently uses version 1.

## Rollout

Provision the `macro.chats` topic before or alongside deploying DCS: a
kafka-cluster stack redeploy picks up the regenerated
`.github/kafka-cluster-topics.json`. If the producer is deployed before the
topic is available, chat mutations still succeed, but events can be lost under
the at-most-once contract.
