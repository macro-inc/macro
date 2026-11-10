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
- `src/inbound/http.rs`, `src/inbound/worker.rs`,
  `src/inbound/notification_events_listener.rs`: HTTP routes, the queue
  worker, and the PostgreSQL LISTEN adapter that forwards delete events.
- `src/outbound/`: one file per channel/concern — `fanout_realtime.rs` +
  `kafka_realtime.rs` (live WebSocket fan-out), `mobile.rs` + `sns_endpoint.rs`
  (push), `email.rs` + `digest_batcher.rs` (digest emails; `email.rs`'s
  `SignedUnsubscribeLinks` signs `domain/models/signing.rs` unsubscribe
  placeholders per recipient), `repository.rs`
  (owned Postgres queries), `withdrawal.rs` (durable suppression),
  `item_preferences.rs` (owner-scoped single and atomic bulk snooze/mute).
- `outbound/notification_consumer/health.rs`: periodic per-instance Kafka
  backlog and telemetry-health logs; offsets stay uncommitted.
- `domain/retention.rs` + `outbound/retention.rs`: bounded 30-day cleanup.

## Scope

- Owns: notification creation, read/unread/snooze state transitions,
  per-channel delivery, and device registration.
- Not here: the lifecycle state enum itself and its transition rules →
  `notification_state`.

## Boundaries

- Depends on: `notification_state`, `kafka_util`, `rate_limit`,
  `macro_authorization`.
- Used by: most feature crates that need to notify a user (`properties`,
  `channels`, `reminders`, `teams`, `messages`, `calendar_events`, ...) and
  `services/notification_service`, `services/agent_harness_service`,
  `services/email_service`.

## Recipes

- Add a new delivery channel: a port in `src/domain/ports.rs` → an adapter
  under `src/outbound/` → wire it in the service in `src/domain/service.rs`.
- Add a new notification trigger: `src/inbound/notification_events_listener.rs`
  (or the relevant inbound adapter) → `src/domain/models.rs` for the event
  shape → `src/domain/service.rs`.

## Tool contracts

- AI notification filters expose agent sessions and omit legacy chat categories and entity targets.

## Checks

- `cargo test -p notification --all-features` (`SQLX_OFFLINE` unset; needs local
  MacroDB and Redis).
- For test edits, also run `RUSTFLAGS=-Dwarnings cargo check -p notification
  --all-features --tests` against the live schema. Ordinary clippy does not
  compile test-only code, while CI rejects its warnings.

## Gotchas

- `user_notification` carries copies of its notification's `event_item_type`,
  `event_item_id` and `notification_event_type`. Entity reads find a viewer's
  rows through `idx_user_notification_viewer_entity_lane` on those copies, and
  an entity read's event-type filter reads the copied type from that index, so a
  row inserted without them never matches an entity read or mark-seen, and a
  migration that rewrites those `notification` columns must update
  `user_notification` too.
- Every recipient row has a `lane` (`NotificationLane`, signal by default),
  decided once at ingress. Noise is stored but never pushed, digested or counted
  as unread. A reader of active rows names one lane: list filters and the entity
  edge (`EntityNotificationQuery`) default to signal, and digest eligibility is
  signal only. Marking an entity's notifications seen or done reads both lanes,
  so opening an entity clears its noise. A new query over `user_notification`
  that leaves the lane out leaks noise into unread state; add its case to
  `outbound/repository/test/lane.rs`.
- The indexes hot reads answer from alone carry the lane
  (`idx_user_notification_viewer_entity_lane`,
  `idx_user_notification_user_pending_lane`, `idx_user_notification_active_lane`,
  `idx_user_notification_channel_threads_lane`).
  An index for a lane-filtered read must include it too, or every probe fetches
  the table row.
- Feature flags gate most adapters (`axum`, `ai_tool`, `clear_ios_push`,
  `schema`, and the default `kafka` for the Kafka publishers and consumer); building without the feature a caller needs silently drops the
  module instead of failing loudly — check `Cargo.toml` before assuming an
  adapter is compiled in.
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
- Crates on `macrod`'s dependency path (`teams`, `model_notifications`,
  `invite_email`) take this crate with `default-features = false`, which keeps
  librdkafka out of the self-hosted daemon; keep it that way.
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
