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
- `src/inbound/kafka_consumer.rs`: the ingestion consumer over every topic
  with public events (`event_stream::topics::DeclaredMacroEvent`).
- `src/inbound/worker.rs`: the SQS delivery worker.
- `src/outbound/http_delivery.rs`: signed HTTPS POST to the webhook endpoint.
- `src/domain/blocked_address.rs`: the one blocked-address classifier, used by
  create/patch validation and outbound delivery. `src/outbound/address_guard.rs`
  is the connect-time resolver that enforces it; never add a second
  classifier or a preflight-only check.

## Scope

- Owns: webhook CRUD/validation, event ingestion matching, and delivery.
- Not here: the business events themselves — this crate only consumes them.
  Normalization, filters and their validation, the event catalog and union,
  webhook lifecycle event types and live streams → `crates/event_stream`.

## Boundaries

- Depends on: `event_stream`, `event_exposure` (via
  `macro_event_broker::exposure`),
  `channels`, `documents`, `messages`, `agent_session`,
  `agent_trigger`, `user_events`, `entity_access`, `macro_event_broker`, `kafka_util`,
  `rdkafka`, `rate_limit`.
- Used by: `services/document_storage_service`, `crates/coding_agent_worker`.

## Recipes

- Add a new ingestible event: follow `crates/event_stream/AGENTS.md`
  ("Make a family public"); ingestion needs no per-event code beyond one
  `ingest_public_event` arm in `src/inbound/kafka_consumer.rs`. A new
  `Audience` class needs its workspace mapping in `src/domain/ingestion.rs`.
- Preview events and wildcard filter matches (`*` included, unlike live
  streams) need the creator's `public-event-stream` flag: `admitted_webhooks`
  in `src/domain/ingestion.rs`. Wildcard syntax is validated only for a
  flagged creator (`WebhookServiceImpl::with_preview_flag`).
- Change delivery retry behavior: `src/domain/delivery.rs` → README's retry
  schedule table (keep them in sync).

## Checks

- `cargo test -p webhook` (`SQLX_OFFLINE` unset).
- `RUST_LOG=info,webhook=trace cargo run ...` for ingestion/delivery tracing
  (see README's Tracing section for span fields).

## Related

- Docs: `crates/webhook/README.md` · Rules: `.agents/rules/rust/architecture.md`
