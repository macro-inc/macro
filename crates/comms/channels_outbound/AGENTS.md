# channels_outbound

## What it is

Part of Chat: the adapters behind the `channels` ports. The Postgres
repository, connection-gateway realtime delivery, contacts and notification
dispatchers, share-permission and side-effect context adapters, and
static-file uploads.

## Start here

- `src/pg_channels_repo.rs`: storage.
- `src/connection_gateway_realtime.rs`: realtime delivery.
- `src/channel_name.rs`: the viewer-dependent channel naming rule, batch name
  resolution and the SQL name search behind `name_search`.
- `src/notification_sender.rs`: channel notification side effects.

## Boundaries

- Depends on: `channels` (with `list`, `ports` and `sqlx`), `entity_access`,
  `notification_hex`, `static_file_service_client`.
- Used by: composition roots, `agent_tools`, `call`, `name_search`,
  `search_service`, and `agent_harness`'s tests.

## Checks

- `cargo test -p channels_outbound --all-features` (`SQLX_OFFLINE` unset;
  requires local MacroDB). The fixtures live in `crates/comms/channels/fixtures`.
