# Liveness

How chips, views, charts, and embeds stay live. One sentence: *nodes store queries; the
executor's prepare step yields each query's table dependencies; version counters + the
existing gateway broadcast "changed"; every viewer re-runs as themselves, debounced.*

## The invariant

Results are never stored, synced, or shared. Three reasons:

1. Results differ per viewer (permission-scoped materialization) — there is no single
   correct value to sync.
2. Writing results into the Loro doc would turn every table edit into CRDT churn across
   every doc embedding a chip on that table.
3. Re-run-on-mount makes "live on open" the zero-machinery baseline; push-invalidation is
   an enhancement layer, not a correctness requirement.

The sync-service keeps the *document* collaborative; query results are ephemeral decorator
state riding alongside it.

## Dependency tracking

The executor already discovers each query's table set via SQLite's authorizer during
prepare ([query-engine.md](query-engine.md)). Every query response includes
`deps: [tableIds]` and `versions: {tableId: n}`. The discovery needed for materialization
doubles as the reactivity graph — no separate SQL analysis, can't drift.

## Invalidation protocol

- Every mutation (row/column/link change) bumps `database_tables.version` and publishes
  `{tableId, version}` — Redis pub/sub behind `connection_gateway`, the same WebSocket
  path that delivers live updates everywhere else (block definitions'
  `liveTrackingEnabled` is precedent).
- We push **"something changed", never rows** — each viewer must re-execute as themselves.
- Client: a mounted decorator holding `deps` sees `tbl_x → v42 > its v41` → re-runs,
  debounced ~300ms to coalesce bursts (someone typing across cells).
- `@tanstack/solid-query` mapping: the version event is
  `invalidateQueries(['dbquery', nodeId])`.

## Refinements

- **Local echo**: when this client caused the mutation (grid or embed edit), bump the
  local version and re-run immediately — don't wait for the round trip. This is what
  makes it *feel* live; the gateway path is for other people's edits.
- **Viewport gating**: only mounted-and-visible decorators subscribe (`LazyDecorator`).
  Thirty chips in a doc → three subscriptions.
- **Fan-out bound**: an edit costs (open docs watching that table) × (one ms-scale query
  each), at human edit rates over human-scale tables. Nothing to shard for years.
- Embeds and write-through views are the same machinery: their own mutation triggers the
  same version bump that refreshes every other surface.

## Bidirectional updates in practice

There is no bidirectional sync — one write path, one read path, every surface uses both:

- Every editable cell anywhere (grid, embed, view, query-result pill) resolves to
  `(rowId, columnId, value)` via result provenance and calls the same mutation API.
  Nothing writes "to a result"; provenance only addresses the write. SQL never mutates.
- The mutation does permission check → Postgres UPDATE (or `entity_properties` for
  shared-bound columns) → activity → version bump → publish. Then the normal read half
  refreshes every subscriber.
- Conflicts: **last-write-wins per cell** (version counters are invalidation signals, not
  locks); cell granularity means edits to different cells of one row never conflict.
- Two-way links: one stored edge (`database_row_links`); the reverse column is computed at
  read time — nothing to keep in sync. The write bumps both tables' versions.
- Shared-property bindings: one write to `entity_properties`; the Tasks module and the
  database each refresh through their own subscription. Two subscribers, one write.
- UX costs to budget: disappearing-row animation when an edit makes a row stop matching a
  view's WHERE ("moved out of this view", not silent removal), and echo suppression
  (mutation-id dedup so your own optimistic update doesn't re-apply on the return event).

## Magic-table tier

`deps: [people]` is noisier than a user table ("any contact changed"), and versioning all
magic data per user is real work. Tiered:

- **v1**: magic-table deps get re-run on mount + window refocus. Staleness measured in
  seconds; invisible for a contact rename.
- **v2**: coarse per-magic-table version signals if usage demands.

The chip architecture is identical across tiers — only the freshness of the invalidation
signal changes — so nothing gets repainted into a corner.
