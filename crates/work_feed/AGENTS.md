# work_feed

## What it is

Part of Home — the combined work feed: one paginated, stacked, live-updating
list of things that need the viewer's attention plus work they recently did.

## Start here

- `src/domain/service.rs`: page, recompute, done/undo use cases.
- `src/domain/policy.rs`: item membership policy — what belongs in the feed.
- `src/domain/stacking.rs`: how related notifications collapse into one entry.
- `src/domain/realtime.rs`: live-update signals.
- `src/outbound/source.rs`: adapters over Soup, notifications, email, and
  activity that supply the underlying items.

## Scope

- Owns: feed membership, stacking, seen/done state, and pagination.
- Not here: the underlying item data itself (notifications, soup rows,
  activity) → `crates/notification`, `crates/soup`, `crates/activity`.

## Boundaries

- Depends on: `entity_access`, `filter_ast`, `item_filters`, `notification`,
  `model_notifications`; optional `activity`, `email`, `soup`, `soup_realtime`,
  `models_soup` (feature `outbound`).
- Used by: `services/document_storage_service`, `crates/graphql_work_feed`,
  `crates/complete_graph`.

## Recipes

- Add a new feed item source: implement a port in `src/domain/ports.rs` → new
  adapter in `src/outbound/` → wire into `src/domain/policy.rs`.

## Checks

- `cargo test -p work_feed` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`
