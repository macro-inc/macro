# crates/search

## What it is

Soup and search: Soup (the unified entity listing behind Home and search) with its realtime fan-out and wire models, item filters, name and full-text search, the work feed, activity and the attention feed.

Layer: `domain` in [`.config/layers.toml`](../../.config/layers.toml), which
lists what this group may depend on. `cargo x deps` reports edges that break it.

## Crates

| Crate | What it is |
| --- | --- |
| [`activity`](activity/AGENTS.md) | Shared infrastructure behind activity feeds, entity timelines, and attribution sorts across the product (Soup, Documents, Forms, Databases, Initiative, and more): one … |
| [`attention_feed`](attention_feed/AGENTS.md) | The shared layer under Macro's attention feeds: Home's work feed (`crates/search/work_feed`) and the notifications inbox (`crates/notifications/notification_inbox`). |
| [`item_filters`](item_filters/AGENTS.md) | Belongs to Search (Soup): typed filter DTOs for every entity type searchable in soup/search, plus the AST layer that expands them into a strict, logically-combinable … |
| [`models_search`](models_search/AGENTS.md) | Part of the Search feature. |
| [`models_soup`](models_soup/AGENTS.md) | Part of the Soup feed (Home/Recent, the unified activity feed). |
| [`name_search`](name_search/AGENTS.md) | Part of the Search feature. |
| [`search_service`](search_service/AGENTS.md) | Part of the Search feature. |
| [`soup`](soup/AGENTS.md) | Backs the Home, Recent, Signal/work-feed, and GraphQL Soup query surfaces. |
| [`soup_realtime_core`](soup_realtime_core/AGENTS.md) | Part of the Soup query feature (Home/Recent/Signal). |
| [`soup_realtime_inbound`](soup_realtime_inbound/AGENTS.md) | Part of the Soup query feature (Home/Recent/Signal): the Kafka consumer that maps document/project/chat/email/channel/property/call/pull-request events to … |
| [`soup_realtime_outbound`](soup_realtime_outbound/AGENTS.md) | Part of the Soup query feature (Home/Recent/Signal): the adapters behind `soup_realtime_core`'s ports. |
| [`work_feed`](work_feed/AGENTS.md) | Part of Home — the combined work feed: one paginated, stacked, live-updating list of things that need the viewer's attention plus work they recently did. |

## Recipes

- Add a crate here: create `crates/search/<name>` with its own `AGENTS.md`
  (from `.agents/templates/AGENTS.md`), add it to the root `members` and run
  `cargo x deps`, which adds its `[workspace.dependencies]` entry once
  something depends on it. Add it to the table above.
