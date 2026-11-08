# frecency_core

## What it is

Shared infrastructure for Search/Soup ranking and other item lists:
frecency (frequency + recency) scoring. This crate holds the models, the
storage and time ports, and the services that record events, aggregate them
and read the top entities. The Postgres storage is
`crates/entities/frecency_outbound`; the polling worker is
`crates/entities/frecency_inbound`.

## Start here

- `src/models.rs`: the score model and decay parameters.
- `src/services.rs`: the scoring/ranking logic.
- `src/ports.rs`: `AggregateFrecencyStorage`, `TimeGetter` and the event ports.

## Scope

- Owns: frecency computation.
- Not here: persistence → `frecency_outbound`; what gets ranked or how it's
  displayed — callers combine this with their own entity filters.

## Boundaries

- Depends on: `item_filters`, `model_entity`, `macro_user_id`. Ports and
  services are behind the `ports` feature; `mock` adds mockall mocks.
- Used by: `channels`, `email`, `soup` (models and ports only), the adapter
  crates, and through the `frecency` facade the composition roots and
  `agent_tools`.

## Recipes

- Add a new signal to the score: `src/models.rs` → `src/services.rs` →
  `frecency_outbound`'s `src/postgres.rs`.

## Checks

- `cargo test -p frecency_core --all-features`

## Related

- Rules: `.agents/rules/rust/db.md`
