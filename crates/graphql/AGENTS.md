# crates/graphql

## What it is

GraphQL adapters over the domain crates, and `complete_graph`, which composes them into the schema the document storage service serves. Each `graphql_<area>` crate exposes one domain's types, queries and mutations.

Layer: `graphql` in [`.config/layers.toml`](../../.config/layers.toml), which
lists what this group may depend on. `cargo x deps` reports edges that break it.

## Crates

| Crate | What it is |
| --- | --- |
| [`complete_graph`](complete_graph/AGENTS.md) | Part of the web client's shared infrastructure: this crate composes the domain GraphQL adapter crates (`graphql_soup`, `graphql_properties`, `graphql_notification` … |
| [`graphql_activity`](graphql_activity/AGENTS.md) | Backs the Activity feed feature across the app: a GraphQL adapter exposing three read surfaces over the `activity_events` log — the viewer's feed, a trailing-year … |
| [`graphql_calendar`](graphql_calendar/AGENTS.md) | Backs the Calendar feature: the GraphQL inbound adapter exposing typed calendar/event/occurrence objects, reads, mutations, and the authenticated user's calendar query … |
| `graphql_channel` |  |
| [`graphql_common`](graphql_common/AGENTS.md) | Shared infrastructure for every product feature's GraphQL adapter crate: request-scoped extractor context, filter-input conversion, and cross-domain schema types (entity … |
| [`graphql_crm`](graphql_crm/AGENTS.md) | Backs the CRM feature: the typed GraphQL inbound adapter for CRM pipeline records (rows that reference a company or contact), composed onto their Soup entities. |
| `graphql_databases` |  |
| [`graphql_email`](graphql_email/AGENTS.md) | Backs the Email feature: the GraphQL inbound adapter exposing message object types, the `EmailThread` edge resolvers, and draft mutations. |
| `graphql_entity_mutation` |  |
| [`graphql_favorite`](graphql_favorite/AGENTS.md) | Backs the Favorites feature (Soup sidebar pinning): the GraphQL inbound adapter exposing ordered favorite objects, user-scoped queries/mutations, and the … |
| [`graphql_initiative`](graphql_initiative/AGENTS.md) | Backs the Initiatives feature (named task groupings): the typed GraphQL inbound adapter exposing initiative queries, mutations, and loaders. |
| [`graphql_notification`](graphql_notification/AGENTS.md) | Backs the Notifications feature: the GraphQL inbound adapter exposing the notification object type, the DataLoader-backed entity notification edge, mutations, and the … |
| [`graphql_notification_inbox`](graphql_notification_inbox/AGENTS.md) | Belongs to the unified notifications inbox. |
| `graphql_permission` |  |
| [`graphql_properties`](graphql_properties/AGENTS.md) | Shared infrastructure for features that attach custom properties to entities (CRM, Initiatives): the GraphQL inbound adapter exposing property object types, definitions … |
| [`graphql_registered_work`](graphql_registered_work/AGENTS.md) | Part of agent sessions: the GraphQL inbound adapter for registered work, the sessions an account registered as its work. |
| [`graphql_scheduled_action`](graphql_scheduled_action/AGENTS.md) | Backs the AI routines (scheduled actions) feature: the GraphQL inbound adapter for listing `ScheduledAction` records. |
| [`graphql_soup`](graphql_soup/AGENTS.md) | Backs the Soup feature (the app's unified entity search/home surface): the soup-domain GraphQL wrapper types. |
| `graphql_soup_filter_input` |  |
| [`graphql_work_feed`](graphql_work_feed/AGENTS.md) | Belongs to the work feed feature: a viewer's aggregated feed of tasks and items needing attention. |

## Recipes

- Add a crate here: create `crates/graphql/<name>` with its own `AGENTS.md`
  (from `.agents/templates/AGENTS.md`), add it to the root `members` and run
  `cargo x deps`, which adds its `[workspace.dependencies]` entry once
  something depends on it. Add it to the table above.
