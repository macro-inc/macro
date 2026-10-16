# graphql_activity

## What it is

Backs the Activity feed feature across the app: a GraphQL adapter exposing
three read surfaces over the `activity_events` log — the viewer's feed, a
trailing-year overview, a per-entity `activity` edge (batched via
DataLoader) — plus database/form timelines and a realtime subscription.

## Start here

- `src/lib.rs`: read the crate doc — it lists exactly which resolver answers
  which surface and why entities carry only `entityType`/`entityId`
  references (clients resolve names from their Soup cache).
- `src/loaders.rs`: `EntityActivityLoader` — the batched per-entity edge;
  touch this when activity needs to appear on a new Soup entity type.
- `src/feed.rs` / `src/overview.rs`: the viewer feed and yearly aggregate.
- `src/timeline.rs`: by-id, access-checked timelines for databases/forms
  (not Soup items, so not loader-batched).
- `src/subscriptions.rs`: the realtime `activityUpdates` subscription.

## Scope

- Owns: GraphQL objects/resolvers over activity; not the event log itself →
  `crates/activity`.

## Boundaries

- Depends on: `activity` (realtime feature), `entity_access`, `graphql_common`.
- Used by: `complete_graph`.

## Recipes

- Add activity to a new Soup entity: `src/loaders.rs` (reader) →
  `crate::activity` port implementation for that entity → wire the edge on
  the entity's GraphQL object in `complete_graph`.

## Checks

- `cargo test -p graphql_activity`.

## Related

- Rules: `.agents/rules/rust/architecture.md`
