# Chat crate

This crate owns AI chat models, persistence ports, service policy, and the
HTTP and toolset adapters for chats and chat messages. Legacy chats are
read-only. The chat service produces sanitized lifecycle events for successful
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
| `chat.created` | Nothing; no longer emitted, kept for existing consumers | `chat_id`, `owner`, `name`, `project_id` |
| `chat.updated` | A chat PATCH (`ChatService::patch`) is persisted | `chat_id`, `actor_user_id`, requested `name`, `previous_project_id`, requested `project_id`, `share_permission_updated` |
| `chat.deleted` | Soft deletion succeeds | `chat_id`, `actor_user_id`, `project_id` |
| `chat.permanently_deleted` | Permanent deletion succeeds | `chat_id`, `actor_user_id`, `project_id` |
| `chat.restored` | `ChatService::revert_delete` succeeds | `chat_id`, `actor_user_id`, `project_id` |
| `chat.copied` | `ChatService::copy_chat` (entity duplication) succeeds | `chat_id` (the new copy), `source_chat_id`, `owner`, `name` |
| `chat.message_sent` | Nothing; no longer emitted, kept for existing consumers | `chat_id`, `message_id`, `role`, `model`, `actor_user_id`, `attachment_count` |
| `chat.message_deleted` | Nothing; no longer emitted, kept for existing consumers | `chat_id`, `message_id` |

Optional metadata is serialized as `null`. On `chat.updated`, `name` and
`project_id` describe the requested PATCH: `null` means the field was omitted,
and `project_id: ""` means the chat was removed from its project (mirroring
the `PatchChatArgs` semantics). `previous_project_id` is the project in the
pre-PATCH chat snapshot when known. `share_permission_updated` is `true` for
any `sharePermission` patch, including an explicit `teamShareAccessLevel`,
which only the chat's persisted owner may set (shared with the owner's team
through the canonical `SharePermission.team_share_*` state and an
`entity_access` team grant). On the deleted, permanently-deleted, and
restored events, `actor_user_id` is `null` for unauthenticated or internal
callers.

`role` on `chat.message_sent` is lowercase (`user`, `assistant`, or `system`)
and distinguishes user messages from assistant messages. `actor_user_id` is
the sender for user messages and `null` for assistant messages. `chat.copied`
is keyed by the new chat's id; `chat.message_sent` is keyed by the parent
chat's id. `chat.message_deleted` is also keyed by the parent chat's id, so
both message events preserve per-chat ordering.

## Sanitization

Event payloads exclude message content and attachment content; the only
attachment-derived value is the `attachment_count` field on `chat.message_sent`.
Share-permission payloads are also excluded: a PATCH that changes share
permissions is represented only by the `share_permission_updated: bool` flag
on `chat.updated`.

`owner` and `actor_user_id` are Macro user IDs serialized as
`macro|<email address>`; they embed the owning or acting user's email and must
be treated as personal data. This matches identifiers already published on the
`macro.documents` and `macro.teams` topics.

## Excluded flows and known gaps

Only the successful mutations in the table produce these events. Read/list
operations emit nothing. Legacy chats are read-only, so nothing creates a
chat, sends or deletes a message, or runs a tool call; `chat.created`,
`chat.message_sent` and `chat.message_deleted` stay in the schema for existing
consumers.

Only the agent harness HTTP chat router and the DSS owned-entity purge publish
to Kafka. The other `ChatServiceImpl` instances (DSS GraphQL entity mutations,
the harness chat tool context, and the `ai_tools` agent contexts) use the
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
