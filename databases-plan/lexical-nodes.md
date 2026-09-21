# Lexical nodes (doc surfaces)

Four surfaces, one rule: **nodes persist queries and references, never results or rows.**
Results differ per viewer (permissions), storing them would churn the Loro CRDT on every
table edit, and re-run-on-mount makes live-on-open the default behavior.

All nodes follow the house 5-step registration (node class in `packages/lexical-core/nodes/`
→ `node-list.ts` → `decoratorRegistry.ts` → transformer in `transformers/` → Solid
decorator + `setDecorator` in `init.ts`), single-XML-tag-with-JSON-body markdown form,
`UnknownMentionNode` fallback for forward compat, and a version counter bump in
`LexicalMarkdown/version.ts`.

## The nodes

### Query chip — inline
- Shape: `DocumentMentionNode` (inline `DecoratorNode`, keyboard-selectable).
- Persists: `{ sql, prompt, displayMode: 'scalar' }`.
- Renders: number-chip with a ⚡ glyph; click → popover with SQL (read + edit via the
  [sql-editor](sql-editor.md)), live status, row count.
- Transformer: `<m-db-query>{json}</m-db-query>`.

### Query block — block
- Same node family, `displayMode: 'table'` — scalar vs table is chosen automatically from
  result shape (1×1 → inline chip; else block).
- Renders: header (name, live dot, row count, source link, SQL toggle) + read-only result
  grid with hydrated chips + the prompt/editor drawer.

### View — block
- Persists: `{ sql, prompt, viewConfig }`. A query wearing a grid: columns are the
  query's projection, cells use the full property editors **where writable** (a result
  column is editable iff it traces to a single base column — Postgres updatable-view
  rule), membership belongs to the WHERE clause so there is no "new row" affordance.
- Footer states the predicate ("rows enter and leave as they match …").

### Chart — block
- Persists: `{ sql, prompt, chartConfig: {kind: 'line' | 'bar', x, y} }`. Same query
  object as a view with a different renderer. Follows the dataviz conventions already in
  the mock (single-series → no legend, recessive grid, hover crosshair + tooltip,
  emphasized live endpoint).
- Note: kanban as a view/renderer kind is **punted entirely** — the grouping/write-back
  model isn't fleshed out; revisit after v1.

### Database embed — block
- Shape: `DocumentCardNode` (block `DecoratorBlockNode` with the reference+preview split).
- Persists: `{ databaseId, tableId, viewConfig }` only. Renders the full editable grid
  inline (same grid primitive as the block, internal scroll past ~300px), header with
  source link + synced indicator.
- Degrades to a "table no longer exists" state if the ref breaks; renders with the
  viewer's permissions in shared docs.
- Transformer: `<m-database>{json}</m-database>`.

## Insertion

- `/` actions menu: Database (→ table picker), View, Chart, Query.
- `@` mentions menu: a "databases" bucket (`BucketConfig` in `MentionsMenuController`) —
  pick a database → pick a table/saved view or "write a query".
- AI: the create-ai-tool path so agents can insert chips/views/charts with generated SQL.

## Rendering discipline

- `LazyDecorator` (viewport-gated, shared IntersectionObserver) wraps every query-running
  decorator — only visible blocks execute and subscribe.
- `AwaitNode`-style pending shimmer while a query is in flight.
- Ephemeral state (results, generation-in-progress) lives in the decorator component,
  never in node state — node state round-trips through markdown XML and the Loro schema.
- Broken states are first-class renders (missing table, missing column, permission-empty),
  never crashes: `⚠ column "status" no longer exists — edit query`.

## Liveness hookup

Each mounted decorator registers its dependency set (returned by the executor) with the
invalidation channel; see [liveness.md](liveness.md). Local mutations from an embedded
grid echo immediately; the same mutation's version bump updates every other surface.
