# sync_router

## What it is

Routes document collaboration from the connection gateway's Redis fanout to
Cloudflare Durable Object sync sockets. It owns routing, not document state.

## Start here

- `src/main.rs`: Redis and downstream adapter wiring, subscriber restart loop.
- `src/domain/router.rs`: one owner for routes keyed by gateway, connection,
  and document; route epochs protect replacements from stale close events.
- `src/inbound/redis_edge.rs`: binary-frame filtering and gateway liveness.
- `src/outbound/do_downstream.rs`: downstream dialing, buffering, and replies.

## Scope

- Owns subscription routing and teardown when clients or gateways disappear.
- Document authorization and state belong to `services/sync-service`; forward
  the scoped token to that service rather than interpreting it here.
- Redis wire types belong to `crates/connection_gateway_models`; browser
  envelopes are generated from `services/sync-service/bebop/schema.bop`.

## Checks

- `cargo test -p sync_router` (domain and adapter tests need no live services).
- `cargo fmt --all -- --check` and `just clippy`.
- After changing dependencies, `cargo x deps --check`.

## Gotchas

- `REDIS_HOST` and `SYNC_SERVICE_URL` are required at startup.
- Document payloads retain the sync protocol's chunk framing. The router does
  not decode or reassemble CRDT updates.
- Redis pub/sub is best effort. Do not assume replay or durable delivery.
- Every router subscribes to the same inbound channel; multiple instances do
  not partition work. Add ownership coordination before horizontal scaling.
- Local Docker and service inventory wiring are not a hosted deployment.
  Provision the router before enabling `VITE_SYNC_VIA_GATEWAY` for clients.

## Related

- Architecture: `../../.agents/skills/cloud-storage-hexagonal-architecture/SKILL.md`
- Rules: `../../.agents/rules/observability.md`
