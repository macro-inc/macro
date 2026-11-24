# database_row_search

## What it is

Part of database row search (Search + Databases). The one definition of a
row's searchable text, read from Postgres: the indexer writes it into the
`database_rows` OpenSearch index, and search recomputes it from the primary
database before exposing a hit.

## Start here

- `src/read.rs`: `read_row_search_text`, one statement over any executor.
- `src/index.rs`: the indexer's journal reads and its per-table watermark
  (`database_row_search_watermarks`, which this crate alone reads and writes).
- `src/visible_text.rs`: which column types are searchable and how a cell
  becomes text (mentions reduced to their visible label).

## Scope

- Owns: the searchable-text rules (title = first column; text, link, select,
  number select and tag labels; nothing else) and the reads behind them.
- Not here: the index document and mapping → `crates/models_opensearch`,
  `infra/stacks/opensearch/helpers`; writing the index →
  `services/search_processing_service`; authorizing hits → `crates/search_service`.

## Boundaries

- Depends on: `mention_utils` only, besides sqlx. Keep it light: `search_service`
  depends on it, so it never takes the `databases` crate.

## Checks

- `cargo test -p database_row_search` (`SQLX_OFFLINE` unset; migrated MacroDB).

## Gotchas

- A database without a `database_entities` row (CRM, forms) and a trashed one
  read as no rows. Entity and relation cells are never read as text: their
  targets' names could name things the viewer cannot open.
- A change to the text rules changes what search matches and shows; it needs a
  full backfill of the index to take effect for rows already indexed.
