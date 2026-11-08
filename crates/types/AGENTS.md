# crates/types

## What it is

Leaf value types shared across the backend and the web client: ids (`macro_user_id`, `bot_id`, `harness_id`), tokens, entity kinds, owners and error responses, and the `model`/`models_<area>` wire models. No I/O; `sqlx`, `utoipa` and similar derives sit behind optional features. New ids get their own `<thing>_id` crate here.

Layer: `types` in [`.config/layers.toml`](../../.config/layers.toml), which
lists what this group may depend on. `cargo x deps` reports edges that break it.

## Crates

| Crate | What it is |
| --- | --- |
| [`agent_session_id`](agent_session_id/AGENTS.md) | Part of agent sessions: `AgentSessionId`, the identity of an agent session, and `ReplicaId`/`ManagerFence`, the harness replica that manages a live session and the … |
| [`bearer_token`](bearer_token/AGENTS.md) | Shared infrastructure for agent sessions and auth: the SHA-256 digest and display prefix of the bearer tokens Macro mints for bots (`mbot_…`) and harnesses (`mhns_…`). |
| `bot_id` |  |
| `bot_token` |  |
| [`calendar_event_id`](calendar_event_id/AGENTS.md) | Shared type for Calendar: `CalendarEventId`, the id of a calendar event row Macro stores, a `uuid_id!` newtype (CS-10). |
| `channel_sender` |  |
| [`chat_id`](chat_id/AGENTS.md) | Shared type for AI chat: `ChatId`, the `TEXT` id of a chat, as a `nutype` String newtype (CS-10). |
| [`chat_message`](chat_message/AGENTS.md) | Part of AI: the role (`Role`) and content (`ChatMessageContent`, `AssistantMessagePart`) of a stored AI chat message, shared by the agent loop, the chat domain, and the … |
| `connection_gateway_models` |  |
| `cow_str` |  |
| `document_sub_type` |  |
| [`entity_basic_types`](entity_basic_types/AGENTS.md) | Shared types: the `DocumentBasic`, `ChatBasic` and `BasicProject` rows that db queries load and `entity_access`'s axum extractors read from request extensions. |
| `filter_ast` |  |
| `harness_id` |  |
| `harness_token` |  |
| [`id_newtype`](id_newtype/AGENTS.md) | Shared infrastructure: `uuid_id!`, the one way to declare a UUID-backed id newtype (CS-10). |
| `macro_sync_service_jwt` |  |
| [`macro_user_id`](macro_user_id/AGENTS.md) | Shared infrastructure: the identity type used across the whole backend. |
| `macro_uuid` |  |
| `maybe_send` |  |
| [`message_parent`](message_parent/AGENTS.md) |  |
| [`model`](model/AGENTS.md) | Shared infrastructure underlying Documents, chat, and authentication. |
| `entity_kind` |  |
| `model_error_response` |  |
| `model_file_type` |  |
| [`model_owner`](model_owner/AGENTS.md) | Shared infrastructure used by nearly every domain crate with typed ownership. |
| `model_user` |  |
| `ai_projection_types` |  |
| `bulk_upload_types` |  |
| [`databases_types`](databases_types/AGENTS.md) | Part of Macro Databases. |
| `dcs_types` |  |
| [`email_types`](email_types/AGENTS.md) | Part of the Email feature. |
| `entity_access_management_types` |  |
| [`forms_types`](forms_types/AGENTS.md) | Part of Macro Forms. |
| `grouping_types` |  |
| `opensearch_types` |  |
| [`pagination_types`](pagination_types/AGENTS.md) | Shared infrastructure. |
| [`permissions_types`](permissions_types/AGENTS.md) | Part of entity sharing/permissions, used across nearly every feature. |
| [`models_properties`](models_properties/AGENTS.md) | Part of the custom-properties feature (custom fields on documents, CRM records, and other entities). |
| `models_search_cursor` |  |
| `models_sfs` |  |
| `models_team` |  |
| [`natural_time`](natural_time/AGENTS.md) | Reads English date and time phrases ("next friday at 3", "end of month", "nov 5-7", "in 2 hours") into calendar dates for task due dates, reminders and calendar events … |
| `non_empty` |  |
| [`notification_state`](notification_state/AGENTS.md) | Part of the notifications feature. |
| [`project_id`](project_id/AGENTS.md) | Shared type for the Projects feature (folders): `ProjectId`, the `TEXT` id of a project, as a `nutype` String newtype (CS-10). |
| [`s3_key`](s3_key/AGENTS.md) | Part of shared infrastructure (cloud storage). |
| [`soup_property`](soup_property/AGENTS.md) | Soup and search: `SoupProperty`, the property (definition plus value) attached to a Soup item or search row. |
| [`team_id`](team_id/AGENTS.md) | Shared type for teams and accounts: `TeamId`, the id of a Macro team, a `uuid_id!` newtype (CS-10) that serializes as the UUID string. |
| [`trigger_context`](trigger_context/AGENTS.md) | Part of agent sessions: plain data for why an agent was called, shared by whatever calls an agent, the runtimes that serve it, and the service that composes its prompt. |
| `user_quota` |  |

## Recipes

- Add a crate here: create `crates/types/<name>` with its own `AGENTS.md`
  (from `.agents/templates/AGENTS.md`), add it to the root `members` and run
  `cargo x deps`, which adds its `[workspace.dependencies]` entry once
  something depends on it. Add it to the table above.
