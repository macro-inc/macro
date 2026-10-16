# notification_state

## What it is

Part of the notifications feature. Defines the shared `NotificationState`
lifecycle enum (`Unseen` / `Seen` / `Done`) and its transition policy, kept
dependency-light so it compiles to wasm.

## Start here

- `src/lib.rs`: the `NotificationState` enum and its invariants — read the
  module doc comment first (viewing timestamps are historical metadata, not
  another state representation).
- `src/postgres.rs`: the `sqlx::Type` mapping to the Postgres
  `notification_state` enum, gated behind the `postgres` feature.
- `src/graphql.rs`: the `async-graphql` enum mapping, gated behind `graphql`.

## Scope

- Owns: the lifecycle enum, its `ACTIVE` set, and (de)serialization across
  JSON, Postgres, and GraphQL.
- Not here: how/when a notification transitions in response to app events →
  `notification`.

## Boundaries

- Used by: `notification`, `item_filters`, `graphql_notification`,
  `graphql_soup_filter_input` — including wasm builds, so this crate must
  stay free of non-wasm-safe dependencies outside the optional features.

## Checks

- `cargo test -p notification_state` (`SQLX_OFFLINE` unset).
- `cargo test -p notification_state --features postgres,graphql` for the
  adapter mappings.

## Related

- Rules: `.agents/rules/rust/architecture.md`
