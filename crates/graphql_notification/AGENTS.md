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

## Notification edge limits

- Omitted or null `notifications(limit:)` returns at most the 20 newest active
  rows per entity; explicit limits must be 1–500. Filters apply before limiting.
- Defaults and explicit `limit: 20` share the same DataLoader selection. Different
  limits/filters remain separate batches. The limit is per entity, not per request.
- Use the paginated notification API for history and entity-scoped mutations for
  bulk state changes; a returned edge is not a complete list of notification IDs.

## Checks

- `cargo test -p graphql_notification` (`SQLX_OFFLINE` unset).
- `cargo test -p complete_graph sdl_test::schema_types_and_fields_have_descriptions`
  verifies exported GraphQL descriptions. Document `#[Object]` impl blocks
  because their documentation supplies the schema type description.

- `notification_event/external_chat.rs` exposes live external chat message metadata (provider, chat name, message id); its notification targets the external chat entity.
- `notification_event/whatsapp_group_stub.rs` is an uninhabited, schema-only `GraphqlWhatsappGroupMessageMetadata` union member kept because released clients spread it; nothing returns it. Delete it (and `GraphqlEntityType::WhatsappGroup`) after 2026-11-30.
- Read a notification's type from `targetEntityType` (canonical `GraphqlEntityType`), so shared entities outside Soup keep their identity. `entityType` keeps its original `GraphqlSoupEntityType` output for deployed clients and is deprecated until 2026-12-01; changing its type would break them (`cargo x graphql-schema-compat`).

## Related

- Rules: `.agents/rules/rust/architecture.md`
