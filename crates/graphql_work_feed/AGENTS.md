# graphql_work_feed

## What it is

Belongs to the work feed feature: a viewer's aggregated feed of tasks and
items needing attention. This crate is the GraphQL inbound adapter exposing
the `workFeed` page, done/undo mutations, and the `workFeedUpdates`
subscription.

## Start here

- `src/query.rs`: `resolve_work_feed`.
- `src/objects.rs`: `GraphqlWorkFeedPage`, `GraphqlWorkFeedEntry`,
  `GraphqlWorkFeedItem`, `GraphqlWorkFeedStack`, `GraphqlWorkFeedPatch`.
- `src/mutations.rs`: mark-done / undo-done mutations.
- `src/subscriptions.rs`: `WorkFeedSubscriptionRoot` — realtime patches.
- `src/context.rs`: `WorkFeedGraphqlContext`, `WorkFeedViewerResolver`.

## Scope

- Owns: GraphQL types/resolvers/subscription for the work feed page.
- Not here: feed composition and item ranking → `crates/work_feed`;
  notification content → `crates/graphql_notification`.

## Boundaries

- Depends on: `work_feed`, `graphql_notification`, `graphql_soup`,
  `entity_access` (inbound feature), `graphql_common`.
- Used by: `complete_graph` (schema composition).

## Recipes

- Add a feed item field: `src/objects.rs` → `src/query.rs` if it needs new
  input scoping (`src/inputs.rs`).
- Add a mutation: `src/mutations.rs` → `work_feed` domain port.

## Checks

- `cargo test -p graphql_work_feed` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`
