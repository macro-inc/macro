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
  `macro.webhooks`, `macro.agent_sessions`, `macro.agent_session_lifecycle`.
- `src/inbound/worker.rs`: the SQS delivery worker.
- `src/outbound/http_delivery.rs`: signed HTTPS POST to the webhook endpoint.

## Scope

- Owns: webhook CRUD/validation, event ingestion matching, and delivery.
- Not here: the business events themselves — this crate only consumes them.

## Boundaries

- Depends on: `channels`, `documents`, `messages`, `agent_session`,
  `agent_trigger`, `entity_access`, `macro_event_broker`, `kafka_util`,
  `rdkafka`, `rate_limit`.
- Used by: `services/document_storage_service`, `crates/coding_agent_worker`.

## Recipes

- Add a new ingestible event: `src/domain/ingestion.rs` (match rule) →
  `src/inbound/kafka_consumer.rs` (subscribe/decode) → README's event table.
- Change delivery retry behavior: `src/domain/delivery.rs` → README's retry
  schedule table (keep them in sync).

## Checks

- `cargo test -p webhook` (`SQLX_OFFLINE` unset).
- `RUST_LOG=info,webhook=trace cargo run ...` for ingestion/delivery tracing
  (see README's Tracing section for span fields).

## Related

- Docs: `crates/webhook/README.md` · Rules: `.agents/rules/rust/architecture.md`
