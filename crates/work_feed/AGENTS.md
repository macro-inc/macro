# work_feed

## What it is

Part of Home — the combined work feed: one paginated, stacked, live-updating
list of things that need the viewer's attention plus work they recently did.
Built on the shared feed layer, `crates/attention_feed`.

## Start here

- `src/domain/service.rs`: page, recompute, done/undo use cases; builds Home's
  items from the shared reader's loaded candidates.
- `src/domain/policy.rs`: item membership policy — what belongs in the feed.
- `src/domain/stacking.rs`: how related notifications collapse into one entry.

## Scope

- Owns: Home's items, membership policy, stacking, primary reason and state.
- Not here: paging, refill, notification loading, done/undo plumbing, live
  batching and the adapters → `crates/attention_feed`; candidate SQL →
  `crates/soup`.

## Boundaries

- Depends on: `attention_feed`, `filter_ast`, `item_filters`,
  `model_notifications`.
- Used by: `services/document_storage_service`, `crates/graphql_work_feed`,
  `crates/complete_graph`.

## Recipes

- Change what Home lists: `src/domain/policy.rs` (filter and candidate types);
  a new candidate kind also needs Soup's `attention.rs` gates and hydration.

## Checks

- `cargo test -p work_feed` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`
