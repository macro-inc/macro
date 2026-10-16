# connection_gateway

## What it is

Shared infrastructure: manages per-entity WebSocket connections so other
services can push messages to a specific connected entity without holding
the socket themselves.

## Start here

- `src/api/connection.rs`: WebSocket upgrade endpoint and connection lifecycle.
- `src/api/message.rs`: HTTP endpoint other services call to send a message to
  a connected entity.
- `src/service/connection.rs` + `src/service/dynamodb.rs`: connection registry,
  backed by DynamoDB (tracks which entity is on which instance).
- `src/service/sender.rs` + `src/service/redis.rs`: cross-instance message
  relay (Redis pub/sub) so a send reaches a connection on another instance.
- `scripts/stale_connections.rs` (`stale_connections` bin): scans DynamoDB for
  connections past the 60s timeout; `README.md` has usage.

## Scope

- Owns: WebSocket connection tracking and message delivery to a connected
  entity, across instances.
- Not here: the message/event payloads themselves, or who is authorized to
  send to whom — callers decide that before calling in.

## Boundaries

- Depends on: `connection_gateway_models`, `macro_authorization`.
- Used by: nearly every other service, through `connection_gateway_client`
  (document_storage_service, document_cognition_service, email_service,
  calendar_service, agent_harness_service, mcp_service, scheduled_action,
  agent_trigger_service, preview_gateway, and domain crates like `channels`,
  `messages`, `databases`, `ai_tools`).

## Recipes

- Add a message/event type sendable over the gateway: `src/model/message.rs` →
  `src/api/message.rs` → `connection_gateway_client` (the crate callers use).
- Debug/clean stale connections: `scripts/stale_connections.rs` (see `README.md`).

## Checks

- `cargo test -p connection_gateway` (`SQLX_OFFLINE` unset).
- `cargo run --features local_auth` then connect on port 8085 (see `README.md`).

## Gotchas

- A send can target a connection on a different instance — it always goes
  through the Redis relay in `src/service/redis.rs`, never a direct in-process
  lookup; don't bypass it when adding a new send path.

## Related

- Rules: `.agents/rules/config-and-service-urls.md`
