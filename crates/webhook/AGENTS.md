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
  `macro.users`, and `macro.call_notifications`.
- `src/domain/stream.rs` / `src/inbound/stream_router.rs`: the live SSE
  stream. `StreamFeed` keeps two minutes of events (shared `Arc`s) for
  clients that ask `resume=true` with a `Last-Event-ID` (`StreamCursor`);
  without `resume=true` the stream is live-only, as before. Heartbeats flow
  while the stream's Kafka consumer progresses (`kafka_stream_consumer.rs`,
  `kafka_util::progress`); a lagging resuming subscriber's stream ends. See README's
  "Live event stream and resuming".
- `src/inbound/worker.rs`: the SQS delivery worker.
- `src/outbound/http_delivery.rs`: signed HTTPS POST to the webhook endpoint.
- `src/domain/mcp/`: MCP Events subscriptions (README's "MCP Events
  subscriptions"): `filter.rs` the compiled filter language, `service.rs`
  subscribe, fan-out, delivery and the expiry sweep (run by
  `document_storage_service`'s `src/mcp_subscription_sweep.rs`),
  `live_subscribers.rs` the in-memory set fan-out narrows each audience to
  (reloaded by `src/mcp_live_subscribers.rs`). Matching reads
  the `mcp_event_subscription_event` index table, which the repository rewrites
  with each stored filter; never match by scanning subscription rows.
  `src/inbound/mcp_router.rs` is the internal
  surface the MCP server calls; `src/outbound/pg_mcp_subscription_repository.rs`,
  `http_mcp_endpoint.rs` (verify and deliver) and `kms_mcp_secret_cipher.rs`
  are its adapters.
- `src/domain/blocked_address.rs`: the one blocked-address classifier, used by
  create/patch validation and outbound delivery. `src/outbound/address_guard.rs`
  is the connect-time resolver that enforces it; never add a second
  classifier or a preflight-only check.

## Scope

- Owns: webhook CRUD/validation, event ingestion matching, and delivery;
  MCP Events subscriptions (storage, matching, verification, delivery).
- Not here: compiling natural-language filters and encrypting MCP secrets
  (`agent_harness_service`).
- Not here: the business events themselves — this crate only consumes them.

## Boundaries

- Depends on: `channels`, `documents`, `messages`, `agent_session`,
  `agent_trigger`, `user_events`, `entity_access`, `macro_event_broker`, `kafka_util`,
  `rdkafka`, `rate_limit`, `webhook_signature`, `cursor_api_key` (KMS, `kms`
  feature).
- Used by: `services/document_storage_service`, `crates/coding_agent_worker`.

## Recipes

- Add a new ingestible event: `src/domain/ingestion.rs` (match rule) →
  `src/inbound/kafka_consumer.rs` and `kafka_stream_consumer.rs`
  (subscribe/decode) → README's event table. Private call notifications
  match only the named user's personal workspace and stream.
- Stream audiences: `StreamAudience` in `src/domain/stream.rs`. `ContactsOf`
  (the user plus everyone who has the user in their directory) is decided per
  subscriber by one exact `WebhookContactChecker::is_contact(subscriber, user)`
  lookup (adapter over the contacts crate's `lookup_contact_ids` in
  `document_storage_service`, which follows the subscriber's
  `contacts-list-reads` flag); directories are directed, so keep the
  subscriber first. Never page a contact list in the stream.
  `user.picture_changed` uses `Any([ContactsOf, Workspace per user team])`,
  with teams resolved once per event in `kafka_stream_consumer.rs`.
- Change delivery retry behavior: `src/domain/delivery.rs` → README's retry
  schedule table (keep them in sync).
- Let MCP filters compare a new payload field: `McpFilterField` in
  `src/domain/mcp/filter.rs` (its `applies_to` and envelope pointer), then the
  filter compiler's schema in `agent_harness_service`. Never add free-text
  or pattern matching: the filter stays exact so delivery is deterministic.

## Checks

- `cargo test -p webhook` (`SQLX_OFFLINE` unset).
- `RUST_LOG=info,webhook=trace cargo run ...` for ingestion/delivery tracing
  (see README's Tracing section for span fields).

## Related

- Docs: `crates/webhook/README.md` · Rules: `.agents/rules/rust/architecture.md`
