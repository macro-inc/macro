# models_permissions

## What it is

Part of entity sharing/permissions, used across nearly every feature. Wire
models for entity sharing: share permissions (user/team/link), access
levels, and the computed `UserItemAccess` a caller has to an entity.

## Start here

- `src/share_permission.rs` + `src/share_permission/`: `SharePermissionV2`,
  `access_level.rs` (`AccessLevel`), `channel_share_permission.rs`,
  `team_share.rs`, `link_share.rs` (`LinkShare`).
- `src/user_item_access.rs`: the resolved access an actor has to an item.

## Scope

- Owns: the share permission and access-level wire models.
- Not here: authorization decisions or resolving access → `entity_access`,
  `macro_authorization`; typed ownership → `model_owner`.

## Boundaries

- Depends on: `macro_user_id`, `model-entity`, `model_file_type`, `model_owner`.
- Used by: `agent_session`, `ai_tools`, `authentication_service`, `call`,
  `channels`, `chat`, `collab_surface`, `databases`, `document_cognition_service`,
  `documents`, `document_storage_service(_client)`, `email_service`,
  `entity_access(_db_utils)`, `entity_access_management`, `entity_mutation`,
  `forms`, `github`, `graphql_entity_mutation`, `graphql_initiative`,
  `initiative`, `macro_db_client`, `macro_middleware`, `model`, `projects`,
  `properties`, `scheduled_action`, `share_permission_db_utils`, `teams`.

## Recipes

- Add a share kind (e.g. a new link-share variant): `src/share_permission/link_share.rs`
  (or `team_share.rs`/`channel_share_permission.rs`) →
  `src/share_permission/access_level.rs` if it changes effective access →
  `share_permission_db_utils` (storage) → `entity_access` (resolution).

## Checks

- `cargo test -p models_permissions` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`
