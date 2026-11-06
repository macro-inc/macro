# crates/types

## What it is

Leaf value types shared across the backend and the web client: ids (`macro_user_id`, `bot_id`, `harness_id`), tokens, entity kinds, owners and error responses, and the `model`/`models_<area>` wire models. No I/O; `sqlx`, `utoipa` and similar derives sit behind optional features. New ids get their own `<thing>_id` crate here.

Layer: `types` in [`.config/layers.toml`](../../.config/layers.toml), which
lists what this group may depend on. `cargo x deps` reports edges that break it.

## Crates

| Crate | What it is |
| --- | --- |
| `bot_id` |  |
| `bot_token` |  |
| `channel_sender` |  |
| `connection_gateway_models` |  |
| `cowlike` |  |
| `document_sub_type` |  |
| `filter_ast` |  |
| `harness_id` |  |
| `harness_token` |  |
| `macro_sync_service_jwt` |  |
| [`macro_user_id`](macro_user_id/AGENTS.md) | Shared infrastructure: the identity type used across the whole backend. |
| `macro_uuid` |  |
| `maybe_send` |  |
| [`model`](model/AGENTS.md) | Shared infrastructure underlying Documents, chat, and authentication. |
| `model_entity` |  |
| `model_error_response` |  |
| `model_file_type` |  |
| [`model_owner`](model_owner/AGENTS.md) | Shared infrastructure used by nearly every domain crate with typed ownership. |
| `model_user` |  |
| `models_ai_projection` |  |
| `models_bulk_upload` |  |
| [`models_databases`](models_databases/AGENTS.md) | Part of Macro Databases. |
| `models_dcs` |  |
| [`models_email`](models_email/AGENTS.md) | Part of the Email feature. |
| `models_entity_access_management` |  |
| [`models_forms`](models_forms/AGENTS.md) | Part of Macro Forms. |
| `models_grouping` |  |
| `models_opensearch` |  |
| [`models_pagination`](models_pagination/AGENTS.md) | Shared infrastructure. |
| [`models_permissions`](models_permissions/AGENTS.md) | Part of entity sharing/permissions, used across nearly every feature. |
| [`models_properties`](models_properties/AGENTS.md) | Part of the custom-properties feature (custom fields on documents, CRM records, and other entities). |
| `models_search_cursor` |  |
| `models_sfs` |  |
| `models_team` |  |
| `non_empty` |  |
| [`notification_state`](notification_state/AGENTS.md) | Part of the notifications feature. |
| [`s3_key`](s3_key/AGENTS.md) | Part of shared infrastructure (cloud storage). |
| [`trigger_context`](trigger_context/AGENTS.md) | Part of agent sessions: plain data for why an agent was called, shared by whatever calls an agent, the runtimes that serve it, and the service that composes its prompt. |
| `user_quota` |  |

## Recipes

- Add a crate here: create `crates/types/<name>` with its own `AGENTS.md`
  (from `.agents/templates/AGENTS.md`), add it to the root `members` and run
  `cargo x deps`, which adds its `[workspace.dependencies]` entry once
  something depends on it. Add it to the table above.
