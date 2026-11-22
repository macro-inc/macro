# import_notion

## What it is

Part of the Notion import feature. Reads a user's Notion workspace (pages,
data sources and their rows, members, page bodies as markdown) into a typed
model for the `import` crate to turn into Macro documents and databases, and
maps a data source onto Macro database columns and cells
(`domain::macro_cells`).

## Start here

- `src/domain/model.rs` + `src/domain/ports.rs`: the contract (`NotionApi`,
  `NotionConnections`, `NotionError`).
- `src/domain/inventory.rs`: walking the workspace; scope, row draining,
  markdown splicing.
- `src/domain/databases.rs`: ordered body occurrences (`container_id` plus
  per-page ordinal), source ownership, and separate external dependencies
  for review; `databases/markdown.rs` skips code, comments and escaped tags.
- `src/domain/macro_cells.rs`: a data source's `ColumnPlan` (column kinds,
  options, UUIDv5 ids derived from the database), its column-create ops, and
  each row's `CellWrite`s.
- `src/domain/views/`: Views API models and pure saved-view translation;
  `bindings` uses the actual column plan, and `translate` returns a `NewView`
  plus typed losses that the import report must surface. Unsupported AND clauses are
  omitted; an incomplete OR group is omitted in full. Approximations preserve
  a superset of source rows and must be visibly labelled by the writer.
- `src/outbound/rest.rs`: requests, retries, pacing; `rest/wire.rs` maps
  Notion's wire shapes to the model.
- `src/outbound/pipedream.rs`: reaching Notion through Pipedream's Connect
  proxy with the user's `notion` connection.

## Scope

- Owns: reading Notion over REST (`Notion-Version: 2026-03-11`, data sources
  API), and the Notion → Macro database column and cell mapping.
- Not here: import planning, writing Macro entities → `crates/import`;
  Pipedream connections and the proxy port → `crates/pipedream_mcp`.

## Boundaries

- Depends on: `pipedream_mcp` (`ConnectionStore`, `ConnectedAppProxy`),
  `models_databases` (the column and cell vocabulary).
- Used by: `import`.

## Checks

- `cargo test -p import_notion`

## Gotchas

- Read-only by construction: the REST client can only send a `NotionRead`
  (GETs, plus the read POSTs `/v1/search` and `/v1/data_sources/{id}/query`);
  never add a variant that writes to the user's Notion.
- One `RequestPacer` per Pipedream account (~3 requests/second), shared by
  every client of it; a `Retry-After` holds every request on the account.
- `query_data_source` cursors are this crate's own JSON, not Notion's: past
  Notion's 10,000-row cap the query restarts from the last row's
  `created_time`, so drain with `inventory::all_rows`, which de-duplicates.
  When more rows share one `created_time` than the cap, the query cannot
  progress: the page says `RowsNext::Truncated` and `DrainedRows.complete`
  is `false`, so a caller never treats the missing rows as deleted.
- `inventory` counts rows and samples titles from the search results (rows are
  pages there) and queries a data source only when search showed none of its
  rows; the ~3 requests/second pacing makes every extra request count.
- Decoding skips (and warns on) a single unreadable search/query item rather
  than failing the page; fixtures in `fixtures/` cover every property type.
- Unknown property and value types map to `Unsupported` / `Empty`, never an
  error. Data sources may have a `data_source_id` parent with their containing
  `database_id` (externally synced sources); retain that database identity.
  Isolate malformed source metadata as `SourceUnavailable` rather than losing
  other sources in the same placement. Transient provider errors still propagate.
- Workspace planning uses `import::…::databases::discover`: bounded standalone
  `read_page_databases` calls, cancellation and progress, discarding markdown
  immediately. Metadata is cached per attempt; transient failures remain retryable.
  Row bodies are read only during writing. The older discovery helper is test-only.
- Database occurrences retain their original tags and byte ranges, including
  unresolved placements. Both Rust and TypeScript read the shared
  `fixtures/database_occurrences.md` grammar fixture; inline/self-closing tags
  and both quote forms count, while code, comments and escapes do not. A container returning no sources is `NeedsViews`,
  not empty: resolve linked views before declaring `EmptyContainer`. View
  selection and translation belong to the caller; a multi-source container
  retains every source, and a URL fragment never supplies the selected view.

- Select/status values retain Notion option ids as well as labels. `ColumnPlan`
  matches by id when supplied and by name only when no id was supplied; callers
  must report `option_losses` and restore reserved option mappings on resume.
  View bindings use the same stable mapping, including renamed options.
- Formula and rollup column names label their values as Notion snapshots.
  Before planning columns, union `macro_cells::date_range_properties` from
  the source rows with stable property ids used by timeline views, then call
  `ColumnPlan::new_with_date_ranges` to preserve both date endpoints.
- `inventory::all_rows` reports raw `rows_read` separately from deduplicated
  rows, including overlap when restarting past the source result cap.
- A view listing that cannot reach its final page returns typed
  `NotionError::IncompleteViewList`; do not represent it as an upstream outage
  or cache a partial listing as complete.
- `NotionApi::list_views` returns paginated ids scoped by `ViewScope`; call
  `retrieve_view` for each full configuration. Listing by source includes
  linked views, whose `parent.database_id` may differ from the source owner.
- Table columns preserve order/width; Macro has no table column-hiding setting.
  Boards require single-select/single-person grouping; timelines require an
  imported date-range column. Unsupported settings, computed filters/sorts,
  people predicates without a complete account mapping, relative dates,
  timestamp sorts, and separate timeline end columns are
  reported as losses. Text cells are trimmed: normalize positive text literals
  and report changed literals; omit blank positive literals, text inequality and
  nonempty predicates, changed negative-contains literals, and negative option
  predicates whose source labels collapse onto one Macro option id. These losses
  broaden results, never hide source rows. The writer owns saved-view ids and
  name uniqueness. Set ViewSetting at the translation site; diagnostic paths
  never classify settings or become display labels. Unknown settings use Other
  and a generic readable description, never a raw configuration key.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/observability.md`
