# webhook

## What it is

Part of the integrations feature — lets external systems subscribe to Macro
events. Outbound webhook management, Kafka event ingestion, FIFO SQS
fan-out, and tracked HTTP delivery. `README.md` has the full contract (event
names, filter semantics, delivery retry schedule, queue config) — read it
before changing ingestion or delivery behavior.

## Start here

- `src/domain/ingestion.rs`: event matching (workspace/filter/id rules).
- `src/domain/delivery.rs`: the delivery state machine and retry policy.
- `src/inbound/kafka_consumer.rs` / `kafka_stream_consumer.rs`: ingestion
  consumers for `macro.documents`, `macro.channels`, `macro.messages`,
  `macro.webhooks`, `macro.agent_sessions`, `macro.agent_session_lifecycle`,
  `macro.users`, `macro.call_notifications`, and `macro.email`.
- `src/inbound/worker.rs`: the SQS delivery worker.
- `src/inbound/email_event_access.rs`: credential gate for email subscriptions.
- `src/outbound/http_delivery.rs`: signed HTTPS POST to the webhook endpoint.
- `src/domain/blocked_address.rs`: the one blocked-address classifier, used by
  create/patch validation and outbound delivery. `src/outbound/address_guard.rs`
  is the connect-time resolver that enforces it; never add a second
  classifier or a preflight-only check.

## Scope

- Owns: webhook CRUD/validation, event ingestion matching, and delivery.
- Not here: the business events themselves — this crate only consumes them.

## Boundaries

- Depends on: `channels`, `documents`, `messages`, `agent_session`,
  `agent_trigger`, `email`, `user_events`, `entity_access`, `macro_event_broker`,
  `kafka_util`, `rdkafka`, `rate_limit`.
- Used by: `services/document_storage_service`, `crates/coding_agent_worker`.

## Recipes

- Add a new ingestible event: `src/domain/ingestion.rs` (match rule) →
  `src/inbound/kafka_consumer.rs` and `kafka_stream_consumer.rs`
  (subscribe/decode) → README's event table. Private call notifications match
  only the recipient's personal workspace and stream; delivered email events
  match only the inbox owner's personal workspace and user-scoped stream.
- Email filters on stream opens, webhook creates, and webhook patches require a
  `UserOrInternal` credential. Bot and harness credentials receive HTTP 403
  (`email events require the inbox owner's own credential`); filters without
  `email.*` events retain their existing access rules.
- Stream audiences: `StreamAudience` in `src/domain/stream.rs`. `ContactsOf`
  (the user plus their contacts) is decided per subscriber by one exact
  `WebhookContactChecker::is_contact` lookup (adapter over the contacts
  crate's `lookup_contact_ids` in `document_storage_service`); never page a
  contact list in the stream. `user.picture_changed` uses `Any([ContactsOf,
  Workspace per user team])`, with teams resolved once per event in
  `kafka_stream_consumer.rs`.
- Change delivery retry behavior: `src/domain/delivery.rs` → README's retry
  schedule table (keep them in sync).

## Checks

- `cargo test -p webhook` (`SQLX_OFFLINE` unset).
- `RUST_LOG=info,webhook=trace cargo run ...` for ingestion/delivery tracing
  (see README's Tracing section for span fields).

## Related

- Docs: `crates/webhook/README.md` · Rules: `.agents/rules/rust/architecture.md`
