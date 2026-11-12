# notification

## What it is

The notifications feature's hexagonal core. Fans a domain event out to
in-app realtime (WebSocket/Kafka), push (mobile/web), and email digests, and
manages per-item preferences, snoozing, and muting.

## How it works

A domain event arrives via HTTP, the queue worker, or the Kafka listener;
the domain service applies per-user preferences/mute/snooze state, then
dispatches to whichever outbound adapters apply (realtime fan-out, push,
digest email). State transitions and device registration are read back
through the same service.

## Start here

- `src/domain/service.rs` + `src/domain/ports.rs`: the notification policy
  and every port an adapter must implement.
- The HTTP routes, AI tool and workers are `crates/notifications/notification_inbound`;
  every adapter is `crates/notifications/notification_outbound`. This crate is
  the domain only, so an adapter edit does not rebuild the ~100 crates that
  depend on it.
- `domain/retention.rs` (+ `notification_outbound`'s `retention.rs`): bounded
  30-day cleanup.

## Scope

- Owns: notification creation, read/unread/snooze state transitions,
  per-channel delivery, and device registration.
- Not here: the lifecycle state enum itself and its transition rules →
  `notification_state`.

## Boundaries

- Depends on: `notification_state`, `rate_limit`, `macro_event_broker`.
  Features `schema` and `ai_tool` add the utoipa and JsonSchema derives the
  inbound crate needs.
- Used by: most feature crates that need to notify a user (`properties`,
  `channels`, `reminders`, `teams`, `messages`, `calendar_events`, ...), the
  two adapter crates, and the services that wire them.

## Recipes

- Add a new delivery channel: a port in `src/domain/ports.rs` → an adapter
  in `notification_outbound` → wire it in the service in `src/domain/service.rs`.
- Add a new notification trigger: `notification_inbound`'s
  `src/notification_events_listener.rs` (or the relevant inbound adapter) →
  `src/domain/models.rs` for the event shape → `src/domain/service.rs`.

## Checks

- `cargo test -p notification --all-features`; the database and Redis tests
  are in `notification_outbound`.

## Gotchas

- `user_notification` carries copies of its notification's `event_item_type`,
  `event_item_id` and `notification_event_type`. Entity reads find a viewer's
  rows through `idx_user_notification_viewer_entity` on those copies, so a row
  inserted without them never matches an entity read or mark-seen, and a
  migration that rewrites those `notification` columns must update
  `user_notification` too.
- Feature flags gate code: `clear_ios_push`, `schema` and `ai_tool` here, and
  `axum`/`ai_tool` on `notification_inbound` and the default `kafka` (the Kafka
  publishers and consumer) on `notification_outbound`. Building without the
  feature a caller needs silently drops the module instead of failing loudly —
  check `Cargo.toml` before assuming an adapter is compiled in.
- Ingress records publication completion only after the queue accepts the
  notification. Retries preserve original IDs, recipients, and lifecycle state.
- Access-request withdrawals suppress delayed ingress and queued push/realtime
  delivery; keep tombstone checks when changing either delivery boundary.
- Channel join requests count in both top-level and channel-feed notification
  filters; keep these filters aligned with the web notification classifier.
- A `calendar_event_join_request` insert is skipped by a `notification` trigger
  when its event has gone or been cancelled or its request is no longer pending,
  since queued ingress can run after that cleanup. `create_notification` reads
  the skipped insert as nothing to deliver, so keep that `rows_affected` check.
  The triggers read `requestId` from the stored metadata, so renaming that field
  needs a migration.
- librdkafka is only in `notification_outbound` (feature `kafka`). Crates on
  `macrod`'s dependency path (`teams`, `model_notifications`, `invite_email`)
  depend on this domain crate only; keep `notification_outbound` off that path
  so librdkafka stays out of the self-hosted daemon.
- Independent Kafka consumers have no durable group lag. Health logs distinguish
  stale/unknown measurements from zero; they are not client-delivery ACKs.
- `EmailContent` is queued as JSON, so its optional `text`, `from_name` and
  `reply_to` carry `#[serde(default)]`. `EmailAdapter` turns `from_name` into an
  `"<name> (via Macro)"` display name on Macro's own From address (quoted when
  ASCII, RFC 2047 encoded otherwise) and sends `text` as the plain-text part.
  Unsubscribe placeholders are signed in the HTML `body` only.
- `EmailAdapter` takes an optional SES configuration set; with one, every send
  uses it and carries a `notification_type` message tag. A set name that does
  not exist in SES fails every send, so create the set before configuring it.
- Notification payloads must not be logged on tracing spans (see the
  `fix(notification): stop recording notification payloads` history).
- Android call pushes carry W3C trace context inside their existing JSON offer;
  keep propagation in the outbound SNS adapter, with no baggage or payload logging.
- iOS egress binds `recipientId` to each receiving account; channel pushes carry
  an optional typed `navigation` destination, with `threadId: null` for a root
  message. Preserve older payloads that omit these fields.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/observability.md`
