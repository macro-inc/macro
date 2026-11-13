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
  (list/read), `unsubscribe.rs` (single and atomic bulk item mute/snooze), `health.rs`.
- `src/ping.rs` + `src/api/ping.rs`: pings
  (`POST /user_notifications/send`, the SDK's `notifications.send`). The
  domain checks that the sender can see the link and that the inbox lists
  its kind (`notification_inbox`'s `CANDIDATE_TYPES`), then for each
  recipient that they can see it, that their inbox would list it
  (`FeedVisibility`, adapter in `src/ping/outbound/feed_visibility.rs`
  over the inbox's `admits_new_notification`, with the recipient's team, and
  Soup on the primary pool, built in `src/wiring.rs`) and that they have room
  under the 60-an-hour cap on what one person receives from others; anyone
  who fails one is skipped and reported. It snapshots the sending agent and
  enqueues through the notification ingress. A channel message link is read
  through the message service (`src/ping/outbound/channel_messages.rs`) and
  filed under its channel. Its notification ids are derived from sender,
  entity, recipients, text and the fixed ten-minute window the send falls in,
  so the ingress drops a repeat in the same window;
  `src/ping/outbound/allowance.rs` caps each sender at 1,000 notified
  recipients an hour and each recipient at 60 from others. It lives here, not in
  `crates/notification`, because `model_notifications` depends on that crate.
- `src/ping/outbound/flags.rs`: where the `enable-agent-notifications`
  flag is read from. `Pings::send` reads it for the sender before anything
  else.
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

- `src/ping/test/delivered.rs` sends a ping for every
  linkable kind, to a teammate and to oneself, and reads it back through the
  real inbox and Home services over Soup; a kind that becomes linkable needs
  entities in `fixtures/ping_links.sql`, or the test fails. Calendar
  events, companies and contacts are the exception: the fixture has none, so
  the test names them in `NOT_IN_FIXTURE`.
- The feed check must read the primary database: a send right after a share
  or a create would otherwise skip the recipient while a replica catches up.
- The feed check probes the inbox's attention query for one item, which
  never reads the recipient's pending notifications, so it costs about
  11 ms per recipient whatever their inbox holds (release build, local
  Postgres: 0 to 50,000 pending; the access check is under 1 ms). Recipients
  are checked 8 at a time per send and at most 16 at a time per process, so
  concurrent large sends queue instead of draining the primary pool. `benchmark_recipient_checks` in
  `src/ping/test/delivered.rs` reprints the numbers;
  `a_probe_costs_the_same_however_many_notifications_are_pending` in Soup
  fails if the probe's planned cost grows with the inbox again (past
  Postgres's JIT threshold, a probe cost about 225 ms at 50,000 pending).
- The feed check's Soup needs the real CRM service: the no-op one lists no
  companies or contacts, so every CRM link would be skipped.

- PostgreSQL delete forwarding emits `notification.delete.publish` spans and
  logs publication failures. The retention Lambda is a separate binary/role;
  see `services/notification_retention_handler` and its rollout runbook.

- Don't log notification payloads on tracing spans (#7892) — they can carry
  sensitive content; log ids/types instead.
- Pings are flag-gated per sender. A local stack has no PostHog
  project, so they are on for everyone there; a deployment reads PostHog with
  the optional `POSTHOG_API_KEY` (and `POSTHOG_HOST`), and without the key
  they are off: `/user_notifications/send` answers 403. A flag that cannot be
  read answers 503, never a send.
- `SES_CONFIGURATION_SET` is optional. When set, every notification email is
  sent through that SES configuration set and tagged `notification_type`, so
  its event destination reports delivery, bounce, open and click per type. Set
  it only once the configuration set exists in that account and region and
  the stack's SES policy (which allows `configuration-set/*`) is deployed.

## Related

- Skill: `new-service`

- The HTTP boundary validates optional signed agent correlation without changing existing authorization.
