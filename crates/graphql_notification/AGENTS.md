# graphql_notification

## What it is

Backs the Notifications feature: the GraphQL inbound adapter exposing the
notification object type, the DataLoader-backed entity notification edge,
mutations, and the realtime subscription.

## Start here

- `src/objects.rs`: `GraphqlNotification`, `load_entity_notifications` — the
  edge most other GraphQL object types embed.
- `src/notification_event.rs` + `src/notification_event/*.rs`: typed
  `GraphqlNotifEvent` payloads per source (CRM discussion, initiative
  discussion, ...) — add a new file here per event kind.
- `src/subscriptions.rs`: `workFeedUpdates`-style realtime notification push.
- `src/mutations.rs`: mark read/unread for an entity or explicit id set.

## Scope

- Owns: GraphQL types/resolvers/subscriptions for notifications and the
  notification edge.
- Not here: notification generation, storage, and delivery → `crates/notification`,
  `crates/notification_state`.

## Boundaries

- Depends on: `notification`, `notification_state` (graphql feature),
  `model_notifications`, `graphql_common`.
- Used by: `complete_graph` (schema composition), `graphql_work_feed`.

## Recipes

- Add a new notification event payload: `crates/notification` (domain event)
  → `src/notification_event/<kind>.rs` → wire it into
  `src/notification_event.rs`.
- Add a mutation: `src/mutations.rs` → the `notification` domain port.

## Checks

- `cargo test -p graphql_notification` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`
