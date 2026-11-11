# import_notion

## What it is

Part of the Notion import feature. Reads a user's Notion workspace (pages,
data sources and their rows, members, page bodies as markdown) into a typed
model for the `import` crate to turn into Macro documents and databases.

## Start here

- `src/domain/model.rs` + `src/domain/ports.rs`: the contract (`NotionApi`,
  `NotionConnections`, `NotionError`).
- `src/domain/inventory.rs`: walking the workspace; scope, row draining,
  markdown splicing.
- `src/outbound/rest.rs`: requests, retries, pacing; `rest/wire.rs` maps
  Notion's wire shapes to the model.
- `src/outbound/pipedream.rs`: reaching Notion through Pipedream's Connect
  proxy with the user's `notion` connection.

## Scope

- Owns: reading Notion over REST (`Notion-Version: 2026-03-11`, data sources
  API).
- Not here: import planning, writing Macro entities → `crates/import`;
  Pipedream connections and the proxy port → `crates/pipedream_mcp`.

## Boundaries

- Depends on: `pipedream_mcp` (`ConnectionStore`, `ConnectedAppProxy`).
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
- `inventory` counts rows and samples titles from the search results (rows are
  pages there) and queries a data source only when search showed none of its
  rows; the ~3 requests/second pacing makes every extra request count.
- Decoding skips (and warns on) a single unreadable search/query item rather
  than failing the page; fixtures in `fixtures/` cover every property type.
- Unknown property and value types map to `Unsupported` / `Empty`, never an
  error.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/observability.md`
