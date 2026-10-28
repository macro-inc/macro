# connection_gateway_client

## What it is

Part of shared infrastructure: the HTTP client for
`services/connection_gateway`, pushing best-effort realtime messages
(invalidation events, channel messages, feature-specific refreshes) to
connected users.

## Start here

- `src/client.rs`: `ConnectionGatewayClient`, `REQUEST_TIMEOUT` (15s — read its
  doc comment before changing; delivery is best-effort, callers don't wait
  indefinitely), and the generic `send_message`/batch methods.
- `src/client/calendar.rs`, `src/client/email.rs`: thin per-feature wrappers
  over the generic send methods (e.g. `refresh_calendar`, `refresh_email`).
- `connection_gateway_models` (sibling crate): the wire types
  (`SendMessageBody`, `BatchSendMessageBody`, `MessageReceipt`, ...).

## Scope

- Owns: the reqwest-based client to the connection gateway and its
  feature-specific convenience methods.
- Not here: the gateway service itself → `services/connection_gateway`; a
  domain port wrapping this client → `crates/connection`.

## Boundaries

- Depends on: `connection_gateway_models`, `model-entity`,
  `macro_tower_layers` (trace header injection).
- Used by: most services and several domain crates (`connection`, `channels`,
  `messages`, `forms`, `databases`, `ai_tools`, `slack_integration`, ...) —
  widely shared; check callers before changing a method signature.

## Recipes

- Add a feature-specific refresh/notification: a new file under
  `src/client/<feature>.rs` with an `impl ConnectionGatewayClient` block
  calling `self.send_message(...)`, declared in `src/client.rs`'s `mod` list.
- Add a new generic send shape: `connection_gateway_models` (wire type) →
  `src/client.rs`.

## Checks

- `cargo test -p connection_gateway_client` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/observability.md`
