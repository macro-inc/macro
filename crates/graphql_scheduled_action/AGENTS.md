# graphql_scheduled_action

## What it is

Backs the AI routines (scheduled actions) feature: the GraphQL inbound
adapter for listing `ScheduledAction` records. Read-only: no mutations.

## Start here

- `src/query.rs`: `resolve_scheduled_actions`.
- `src/objects.rs`: `GraphqlScheduledAction`.
- `src/context.rs`: `ScheduledActionGraphqlContext`.
- `src/lib.rs` `unavailable`: wraps a `rootcause::Report` into a generic
  `INTERNAL_SERVER_ERROR` GraphQL error without leaking details.

## Scope

- Owns: GraphQL types/query for listing scheduled actions.
- Not here: routine scheduling, triggers, and execution →
  `services/scheduled_action`.

## Boundaries

- Depends on: `scheduled_action` (the service crate, not a ports-only domain
  crate — note this is the one `graphql_*` crate reaching into a `services/`
  path).
- Used by: `complete_graph` (schema composition).

## Recipes

- Add a field to the listing: `src/objects.rs` → `src/query.rs`.

## Checks

- `cargo test -p graphql_scheduled_action` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`
