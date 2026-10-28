# connection

## What it is

Part of shared infrastructure: a domain port over the connection gateway,
sending realtime invalidation events and arbitrary channel messages to
users, independent of the HTTP client.

## Start here

- `src/lib.rs`: hexagonal layout — domain + outbound only, no inbound.
- `src/domain/ports.rs`: `ConnectionGateway` (outbound trait) and
  `ConnectionService` (the port callers depend on).
- `src/domain/service.rs`: the service implementation adapting a
  `ConnectionGateway` to `ConnectionService`.
- `src/outbound/connection_gateway_client.rs`: the `ConnectionGateway` adapter
  over `connection_gateway_client`.

## Scope

- Owns: the `ConnectionService` port (invalidation events, channel messages)
  and its adapter onto `connection_gateway_client`.
- Not here: the HTTP transport and request shapes to the gateway →
  `crates/connection_gateway_client`.

## Boundaries

- Depends on: `entity_access` (ports), `connection_gateway_client` +
  `model-entity` (outbound feature).
- Used by: `call`, `documents`, `ai_tools`, `document_storage_service` — a
  composition root constructs the outbound adapter; domain crates depend on
  `ConnectionService`/`ConnectionGateway`, never the client directly.

## Recipes

- Add a new message kind: `src/domain/models.rs` (event/message type) →
  `src/domain/ports.rs` → `src/domain/service.rs` →
  `src/outbound/connection_gateway_client.rs`.

## Checks

- `cargo test -p connection` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`
