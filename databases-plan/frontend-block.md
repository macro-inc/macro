# The database block (frontend)

The full-screen surface at `/app/database/<id>`: tabs are tables, columns are property
bindings, cells are the property editors. Notion-database-pilled, not spreadsheet-pilled:
no A1 references, no per-cell formulas — the escape hatch for computation is SQL chips.

Interactive mock: https://claude.ai/code/artifact/635f0600-3d70-4a70-8564-f37af63042aa

## Block registration (the well-worn path)

1. `'database'` in `BlockRegistry` (`apps/web/src/lib/core/block.ts`) + entries in
   `NonDocumentBlockTypes`, `_ValidBlockCombinations` / `ValidNestingCombinations`
   (exhaustive records — TS points at every touch point).
2. `apps/web/src/features/block-database/definition.ts` — `defineBlock({...})`;
   `features/block-agent/definition.ts` is the 30-line template.
3. `BlockComponentProps` / `BlockComponentLoadData` typing entries.
4. Launcher: `TOKENS.create.database` in `lib/core/hotkey/tokens.ts`, one
   `CREATABLE_BLOCKS` entry + one `runCreateAction` case in
   `features/command/Launcher.tsx` (`c` → `b`), icon.
5. Entity plumbing: `buildEntityData.ts`, `entity-icon.tsx`, `blockNameToItemType`,
   soup filter configs, `category-search-filters.ts`. (Grep `'agent'` across
   `apps/web/src` for the exact touch-point set — most recent addition.)
6. Splits, sharing modal, routing come free from the split-layout system.

## The grid

**Hand-rolled, house style — no grid library.** Extract the existing pattern into a shared
primitive:

- Column-definition convention from
  `features/next-soup/soup-view/views/companies/company-grid-template.ts` (typed column
  array → `grid-template-columns` / `grid-template-areas` strings).
- Row layout from `company-grid-layout.tsx` / `tasks/task-grid-layout.tsx`.
- Virtualization: `virtua/solid` `Virtualizer` (soup-view does this at ~1400 lines; ours
  starts smaller).
- Cell editors and renderers ARE `features/property/` — `Property.Root/Icon/Text/Chips`
  slots, `editors/` for inline editing, `CreatePropertyModal`'s type picker for "change
  column type". Entity cells use the existing mentions typeahead.
- Selection/keyboard: `components/list/` (`create-list-controller`,
  `create-selection-state`) for row selection; cell-level keyboard nav is new work.

## Surfaces & affordances

- **Tabs** = tables, `+` adds one, double-click renames. The only place the
  "database is a collection" concept surfaces.
- **Views strip**: Table only in v1. Kanban is **punted entirely** — the
  grouping/write-back model isn't fleshed out (what does dragging a card mean for
  multi-select columns? group by lookup?); revisit post-v1 with `CompanyKanban.tsx` as
  the eventual precedent. View configs (filters/sorts/column layout) still persist to
  `crates/saved_views`.
- **Filter pills compile to predicates** shared with SQL. "view as SQL" shows the query
  the clicks built — the GUI path and the SQL path are one engine, so they can't drift.
  It's also the best SQL-literacy funnel we have.
- **New row**: ghost row at the bottom ("+ New row — or type @ to add an existing
  person"). For link/entity-restricted tables, the add affordance leads with search
  (you don't author a call); for authorable types it leads with create.
- **Bare rows**: name cell as plain text, no entity. Hover hint `⌘↵ make contact`.
  Hydration keeps property values.
- **Type restriction is inferred, not asked**: start untyped; when every row is (say) a
  person, a quiet banner offers "Restrict to People?" — the payoff is type-specific
  suggested columns (email, company). Never a creation-time modal.
- **Row menu** distinguishes `Remove from table` (membership edge — never deletes the
  entity) from `Delete entity…` (the scary one). Getting this crisp is what makes users
  trust databases with real entities.
- **Column header menu**: rename / sort / hide / delete / change type; a note that a
  column is a database-scoped property, promotable to workspace.

## Column add menu

Primitive types (Text/Number/Select/Person/Checkbox/Date), then:

- `Link to table…` → target picker (see [links-and-lookups.md](links-and-lookups.md)).
- Per existing link column: a "Through <link> 🔗" section offering lookups + rollups.

## Naming

Users only ever see **"table"**; "database" appears nowhere in UI copy. Launcher letter
TBD (`b` for base vs `t` — `t` may collide with task).

## Data flow

Grid mutations go through the databases API (never SQL). Local edits echo optimistically;
remote edits arrive via the liveness channel ([liveness.md](liveness.md)) keyed on table
version counters. Server-state via `@tanstack/solid-query` in `service-clients` per house
rules; queries in `src/lib/queries` if shared.
