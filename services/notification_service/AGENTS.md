# notification_service

## What it is

Serves Notifications across the product: a deployable service that composes
the `notification` domain crate into a running process. Exposes an HTTP API
for reading/unsubscribing from notifications, plus the Kafka-driven egress
worker that sends email/mobile-push/websocket notifications.

## Start here

- `src/main.rs`: composition root — wires `NotificationEgressService`,
  `NotificationWorker`, `NotificationEventsListener`, and the outbound adapters
  (`EmailAdapter`, `MobilePushAdapter`, `WebSocketGatewayAdapter`,
  `Kafka*RealtimePublisher`, `RedisRateLimitAdapter`) from `crates/notification`.
- `src/api.rs` + `src/api/context.rs`: HTTP routes — `user_notification.rs`
  (list/read), `unsubscribe.rs`, `health.rs`.
- `src/model/notification.rs`: service-local request/response shapes.
- Push payload schemas come from `notification::domain::models::apple`; keep the
  frontend push validators generated from those same OpenAPI components.
- `README.md`: local DB setup (`sqlx database setup` from
  `crates/notification_db_client`).

## Scope

- Owns: process wiring (config, adapters, HTTP routes) for notifications; the
  domain logic (digesting, egress rules, send decisions) lives in
  `crates/notification` and `crates/notification_db_client`.
- Not here: notification domain logic itself → `crates/notification`.

## Recipes

- Add a notification HTTP route: `src/api/user_notification.rs` (or a new
  module) → `src/api.rs` → `src/openapi.rs`.
- Add a new egress channel: implement the port in `crates/notification`
  (`outbound/`) → wire the adapter in `src/main.rs`.

## Checks

- `cargo test -p notification_service` (`SQLX_OFFLINE` unset; needs local
  MacroDB — `just run_dbs -d`, then `sqlx database setup` from
  `crates/notification_db_client`).

## Gotchas

- PostgreSQL delete forwarding emits `notification.delete.publish` spans and
  logs publication failures. The retention Lambda is a separate binary/role;
  see `services/notification_retention_handler` and its rollout runbook.

- Don't log notification payloads on tracing spans (#7892) — they can carry
  sensitive content; log ids/types instead.

## Related

- Skill: `new-service`
