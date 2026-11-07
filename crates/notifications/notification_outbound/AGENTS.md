# notification_outbound

## What it is

Part of Notifications: every adapter behind the `notification` ports, one file
per channel or concern: `fanout_realtime.rs` + `kafka_realtime.rs` (live
WebSocket fan-out), `mobile.rs` + `sns_endpoint.rs` (push), `email.rs` +
`digest_batcher.rs` (digest emails; `email.rs`'s `SignedUnsubscribeLinks`
signs the domain's `models/signing.rs` unsubscribe placeholders per
recipient), `repository.rs` (owned Postgres queries), `withdrawal.rs` (durable
suppression), `item_preferences.rs` (owner-scoped single and atomic bulk
snooze/mute, and a channel's mentions-only level), `retention.rs` (bounded 30-day cleanup).

## Start here

- `src/repository.rs`: the Postgres queries.
- `src/notification_consumer/health.rs`: periodic per-instance Kafka backlog
  and telemetry-health logs; offsets stay uncommitted.
- `src/bulk_action.rs`: storage for bulk actions over one user's
  notifications and their per-notification ledger. Every state-changing step
  is one transaction over the action row, the ledger and `user_notification`;
  keep it that way. `user_notification.done_by` is cleared by a trigger on any
  other state change, so new state writers need no change.

## Boundaries

- Depends on: `notification` (domain), `kafka_util`/`rdkafka` (feature
  `kafka`, on by default), Redis, SNS, SES, SQS.
- Used by: the composition roots, `ai_tools`, `properties_service`,
  `tooling/notification_sandbox`. Never on `macrod`'s path (librdkafka).

## Checks

- `cargo test -p notification_outbound --all-features` (`SQLX_OFFLINE` unset;
  needs local MacroDB and Redis).
- For test edits, also run `RUSTFLAGS=-Dwarnings cargo check -p
  notification_outbound --all-features --tests` against the live schema.
  Ordinary clippy does not compile test-only code, while CI rejects its
  warnings.
