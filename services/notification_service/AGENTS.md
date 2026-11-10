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
  (list/read), `unsubscribe.rs` (single and atomic bulk item mute/snooze),
  `health.rs`, and `/notification_stacks`, whose router lives in
  `crates/notification_routing`.
- `src/stack_flags.rs`: where the `enable-notification-stacks` flag is read from.
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
  module) → `src/api.rs` → `src/api/swagger.rs`.
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
- Notification stacks are flag-gated per person. A local stack has no PostHog
  project, so stacks are on for everyone there; a deployment reads PostHog
  with the optional `POSTHOG_API_KEY` (and `POSTHOG_HOST`), and without the
  key stacks are off: nothing is routed and `/notification_stacks` answers 404.
- The ingress service is built `.with_router(StackRouter)`, and the connection
  gateway sender is wrapped in `SignalOnlyRealtimeSender`. Remove either and
  noise is no longer routed, or alerts every connected client.
- `SES_CONFIGURATION_SET` is optional. When set, every notification email is
  sent through that SES configuration set and tagged `notification_type`, so
  its event destination reports delivery, bounce, open and click per type. Set
  it only once the configuration set exists in that account and region and
  the stack's SES policy (which allows `configuration-set/*`) is deployed.

## Related

- Skill: `new-service`

- The HTTP boundary validates optional signed agent correlation without changing existing authorization.
