# channel_id

## What it is

Shared type for Channels: `ChannelId`, the id of a Macro channel, a
transparent `Uuid` newtype (CS-10).

## Boundaries

- Depends on: `serde`, `uuid`; `utoipa` behind `schema`.
- Used by: `soup_types`, which re-exports it.

## Checks

- `cargo test -p channel_id --all-features`

## Gotchas

- The field is public (`ChannelId(uuid)`, `.0`) because about a hundred
  call sites build or read it that way; moving it to `id_newtype::uuid_id!`
  means rewriting them.
- The doc comment is the published OpenAPI description; changing it changes
  the API schema.
