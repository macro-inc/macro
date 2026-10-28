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
  (push), `email.rs` + `digest_batcher.rs` (digest emails), `repository.rs`
  (owned Postgres queries), `withdrawal.rs` (durable suppression),
  `item_preferences.rs` (snooze/mute).
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

- Feature flags gate most adapters (`axum`, `ai_tool`, `clear_ios_push`,
  `schema`, and the default `kafka` for the Kafka publishers and consumer); building without the feature a caller needs silently drops the
  module instead of failing loudly — check `Cargo.toml` before assuming an
  adapter is compiled in.
- Ingress records publication completion only after the queue accepts the
  notification. Retries preserve original IDs, recipients, and lifecycle state.
- Access-request withdrawals suppress delayed ingress and queued push/realtime
  delivery; keep tombstone checks when changing either delivery boundary.
- Crates on `macrod`'s dependency path (`teams`, `model_notifications`,
  `invite_email`) take this crate with `default-features = false`, which keeps
  librdkafka out of the self-hosted daemon; keep it that way.
- Independent Kafka consumers have no durable group lag. Health logs distinguish
  stale/unknown measurements from zero; they are not client-delivery ACKs.
- Notification payloads must not be logged on tracing spans (see the
  `fix(notification): stop recording notification payloads` history).
- iOS egress binds `recipientId` to each receiving account; channel pushes carry
  an optional typed `navigation` destination, with `threadId: null` for a root
  message. Preserve older payloads that omit these fields.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/observability.md`
