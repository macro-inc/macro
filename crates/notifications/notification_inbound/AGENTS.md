# notification_inbound

## What it is

Part of Notifications: the inbound adapters for `notification`. The HTTP
routes (feature `axum`), the AI notification tool (`ai_tool`), the ingress and
push-event queue workers, and the PostgreSQL LISTEN adapter that forwards
delete events.

## Start here

- `src/http.rs`: routes; `http/` holds devices and preferences.
- `src/worker.rs`, `src/ingress_worker.rs`, `src/push_notification_event_worker.rs`:
  the queue workers.
- `src/notification_events_listener.rs`: the LISTEN adapter.
- `src/ai_tool.rs`: the AI tool.

## Boundaries

- Depends on: `notification` (domain), `macro_authorization` (axum).
- Used by: `services/notification_service`, `services/agent_harness_service`,
  `agent_tools`.

## Tool contracts

- AI notification filters expose agent sessions and omit legacy chat categories and entity targets.

## Checks

- `cargo test -p notification_inbound --all-features`

## Gotchas

- Handlers pin their OpenAPI `tag` to the path `notification_service` listed
  before the crate split (`notification_crate::inbound::http…`), so the
  generated notification client stays unchanged.
