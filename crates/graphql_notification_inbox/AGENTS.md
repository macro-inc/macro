# graphql_notification_inbox

## What it is

Belongs to the unified notifications inbox. This crate is the GraphQL
inbound adapter exposing `user.notificationInbox`, the done, undo and seen
mutations, and the `notificationInboxUpdates` subscription. Its shapes mirror
`graphql_work_feed`'s so the web's shared live feed client serves both.

## Start here

- `src/objects.rs`: page, entry, row and patch objects.
- `src/inputs.rs`: scope, row type and mutation inputs with their limits.
- `src/subscriptions.rs`: realtime patches, batched by `attention_feed`'s
  `live::coalesce` with `FiledEntity` triggers.
- `src/context.rs`: `NotificationInboxGraphqlContext`.

## Scope

- Owns: GraphQL types, resolvers and subscription for the inbox.
- Not here: row rules and inbox membership → `crates/notification_inbox`;
  notification content → `crates/graphql_notification`.

## Boundaries

- Depends on: `notification_inbox`, `attention_feed` (inbound feature),
  `graphql_notification`, `graphql_soup`, `graphql_common`.
- Used by: `complete_graph` (schema composition).

## Checks

- `cargo test -p graphql_notification_inbox`
- After changing the schema: regenerate `static_assets/schema.graphql`
  (`cargo run -p complete_graph --bin graphql_schema -- static_assets/schema.graphql`)
  and the web's generated GraphQL types, then `cargo x graphql-schema-compat`.

## Gotchas

- `NotificationInboxEntry` has no `id` (it is per scope); `NotificationInboxRow.id`
  is the normalized key and must stay globally consistent.

## Related

- Rules: `.agents/rules/rust/architecture.md`
