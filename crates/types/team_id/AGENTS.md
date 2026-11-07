# team_id

## What it is

Shared type for teams and accounts: `TeamId`, the id of a Macro team, a
`uuid_id!` newtype (CS-10) that serializes as the UUID string.

## Boundaries

- Depends on: `id_newtype`; `sqlx` and `utoipa` behind the `sqlx` and
  `schema` features.
- Used by: `teams` (`TeamService`), `authentication_service`.

## Checks

- `cargo test -p team_id --all-features`

## Gotchas

- `slack_integration::domain::models::TeamId` is a different type: it rejects
  nil/max UUIDs and comes from an admin receipt. Don't merge the two without
  keeping that validation.
- Most `team_id` fields are still raw `Uuid`; convert at the boundary with
  `TeamId::from_uuid` / `as_uuid` until they move over.
