# share_permission_db_utils

## What it is

Part of shared infrastructure (sharing and permissions). Small SQL helpers
for `SharePermission` and `ChannelSharePermission` rows — specifically
team-level link-share defaults and team sharing.

## Start here

- `src/lib.rs`: `get_team_default_link_share` — resolves a user's team's
  link-share preference, with the strongest membership winning on multi-team
  users (mirrors `entity_access::get_user_team`).
- `src/team_share.rs`: team share-permission helpers.

## Scope

- Owns: a handful of standalone SQL queries against `team`/`team_user` and
  the share-permission tables, for callers that need them without pulling in
  a full domain crate.
- Not here: authorization decisions or general entity access → `entity_access`,
  `entity_access_db_utils`; a user's own role/permission grants →
  `roles_and_permissions`.

## Boundaries

- Depends on: `entity_access_db_utils`, `models_permissions`, `macro_user_id`,
  `macro_uuid`, `model_owner`.
- Used by: `agent_session`, `call`, `channels`, `chat`, `documents`,
  `initiative`, `projects`.

## Recipes

- Add a query: `src/lib.rs` or `src/team_share.rs` (follow the existing
  `sqlx::query!` + doc-comment style) → fixtures in `fixtures/` if a new
  table shape is needed → test in the sibling `test.rs`.

## Checks

- `cargo test -p share_permission_db_utils` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/db.md`, `.agents/rules/rust/architecture.md` (CS-27)
