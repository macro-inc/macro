# form_id

## What it is

Shared types for Forms: the ids of a form and its parts (`FormId`,
`FormSectionId`, `FormQuestionId`, `FormResponseId`, `BookingProfileId`,
`BookingEventTypeId`), each a `uuid_id!` newtype (CS-10) that is the plain
UUID string on the wire and in every generated schema.

## Boundaries

- Depends on: `id_newtype`, `utoipa`, `specta`; `schemars` behind `schema`.
  A hakari traversal exclude.
- Used by: `models_forms`, which re-exports every id, and through it `forms`.

## Checks

- `cargo test -p form_id --all-features`

## Gotchas

- The `schema` feature derives each id's JSON Schema (titled with the id's
  name), unlike `database_id`, which inlines the UUID's; agent tool schemas
  depend on that difference, so don't unify them without regenerating.
