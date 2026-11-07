# project_id

## What it is

Shared type for the Projects feature (folders): `ProjectId`, the `TEXT` id of
a project, as a `nutype` String newtype (CS-10).

## Boundaries

- Depends on: `nutype`; `sqlx` and `utoipa` behind the `sqlx` and `schema`
  features.
- Used by: `projects` (`ProjectService`), `ai_tools`.

## Checks

- `cargo test -p project_id --all-features`

## Gotchas

- Not validated: stored ids are usually UUID strings but need not be (tests
  and old rows use others), so parsing would reject real data.
- "Project" here is the folder entity (`EntityType::Project`, crate
  `projects`), not the product's projects, which are `initiative`s.
- `entity_access`'s `ProjectId` is an axum request-body shape, not this id.
