# frecency_inbound

## What it is

Part of frecency scoring: the polling worker that periodically drives
`frecency_core`'s event aggregator and persists aggregate scores.

## Start here

- `src/polling_aggregator.rs`: `FrecencyAggregatorWorkerHandle`.

## Boundaries

- Depends on: `frecency_core`.
- Used by: `services/connection_gateway`, through the `frecency` facade.

## Checks

- `cargo check -p frecency_inbound`
