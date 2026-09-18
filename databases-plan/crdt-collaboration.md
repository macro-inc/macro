# CRDT-backed databases (real-time multiplayer)

Scope for moving table *state* (rows, cells, links, row order) from "Postgres is the only
truth" to "a Loro document per table is the truth; Postgres is a projection". Schema
(databases, tables, columns, options) stays structured in Postgres. SQL stays the only row
mutation API for programs; humans get a live, offline-capable, undoable grid.

Status: **scoping — no decision taken yet.** Everything below reuses infrastructure that
already exists on `main`; the two genuinely new server pieces are called out in §6.

## 1. What changes and what doesn't

| Concern | Today (shipped) | CRDT-backed |
|---|---|---|
| Truth for rows/cells/links/order | `database_rows.cells` JSONB, `database_row_links`, `position` | Loro doc per table in sync-service (`collab_surface` parent = the `Database`) |
| Truth for schema | Postgres (`database_tables`, `database_columns` → `property_definitions`, options) | unchanged |
| Grid edits | `POST /databases/exec` (UPDATE … WHERE row_id) + refetch | local Loro ops → instant, merged, undoable; synced over the sync-service WS |
| SQL writes (console, MCP, SDK) | changeset → `RowChange` → Postgres in a CAS transaction | changeset → `RowChange` → **semantic ops applied inside the table's Durable Object** with `expectedRevision` CAS |
| SQL reads / materialization | Postgres → SQLite | **unchanged** — Postgres is now a projection kept current by the sync-service webhook |
| Liveness for SQL surfaces (chips, console, embeds) | `database_table_changed` gateway message | unchanged (fired by the projection) |
| Presence | none | awareness (`EphemeralStore`) cell cursors |
| Offline | none | IndexedDB WAL + snapshot (free from `@macro-inc/collaboration`) |
| Undo | none | Loro `UndoManager` (peer-scoped; server-peer writes are not in your stack, same as AI edits) |
| Conflict model | CAS on `database_tables.version`, whole-batch reject | per-cell LWW, per-row-order move semantics, per-link set semantics — no rejects between humans; CAS only for the SQL path |

The `liveness.md` objection to Loro ("results in the doc = CRDT churn") is about *query
results*; it does not apply to row state and is preserved: results are still never stored.

## 2. Document model (one Loro doc per table)

Defined with `@loro-mirror/core` `schema(...)` in a new `packages/databases-crdt` (mirrors
`MARKDOWN_LORO_SCHEMA` / `SPREADSHEET_LORO_SCHEMA`), shared by the browser, the
ai-editing-worker, and `lexical-service` (which is how Rust reads CRDTs today).

```ts
export const DATABASE_TABLE_LORO_SCHEMA = schema({
  // Row order. Movable list keyed by row id: concurrent inserts and moves converge
  // (the markdown `children` precedent). Presence in this list == the row exists.
  rows: schema.LoroMovableList(schema.String(), (rowId) => rowId),
  // Cells, flat map keyed `${rowId}:${columnId}` → PropertyValue JSON (serde-tagged, the
  // same encoding `database_rows.cells` uses). Flat map: stable identity when two peers
  // first write the same empty cell (the spreadsheet precedent); per-cell LWW.
  cells: schema.LoroMap({} as Record<string, PropertyValueJson>),
  // Link edges, flat map keyed `${columnId}:${sourceRowId}:${targetRowId}` → true.
  // Set semantics: add/remove converge, no ordering to fight over.
  links: schema.LoroMap({} as Record<string, true>),
  // Row bookkeeping: `${rowId}` → { createdBy, createdAt }. Never edited after creation.
  rowMeta: schema.LoroMap({} as Record<string, { createdBy: string; createdAt: string }>),
  // Which schema the doc was last projected against, for the projection's sanity check.
  meta: schema.LoroMap({ tableId: schema.String(), schemaVersion: schema.Number() }),
});
```

Decisions baked into the shape:

- **Per table, not per database.** Matches today's version/invalidation granularity, keeps
  each Durable Object bounded (a DO holds the whole doc in memory), lets a client open only
  the visible tab's socket, and cross-table links only need row ids (strings), never a
  shared doc. Cost: N tabs = N sockets when several are open; a database-level doc is not
  needed for anything.
- **Row deletion** = remove from `rows` + delete the row's `cells`/`links`/`rowMeta` keys.
  A concurrent edit to a deleted row resurrects nothing (the cell key comes back but the
  row is absent from `rows`); the projection drops orphan cells and a periodic shallow
  snapshot compacts them.
- **Text cells are plain values in v1.** Collaborative typing *inside* one cell
  (LoroText per STRING cell) is a clean follow-up: the schema gains
  `text: LoroMap<rowId:colId → LoroText>` and the grid swaps the editor for STRING columns.
- **Schema stays out of the doc.** Columns/options change rarely and need Postgres-side
  validation (definitions, options, links to other tables); the doc only carries
  `meta.schemaVersion` so the projection can detect a stale client. Peers learn about new
  columns the way they do today (`database_table_changed` → refetch `DatabaseDetail`).
- **Golden ancestry.** `static_assets/database-table-golden.1.bin` seeds every table doc so
  optimistic first edits converge (the markdown/spreadsheet rule).

Encoding of cells is exactly today's `PropertyValue` JSON, so `materialize.rs`,
`translate.rs`, and the tools keep their contracts.

## 3. Read path (unchanged shape, new source)

- **Grid**: reads the local Loro doc through `LoroManager` (`onStateChange`), not
  `SELECT * FROM t`. The rows query and `read_versions` plumbing go away for the active
  table; the console still uses `exec`.
- **SQL / MCP / SDK / chips**: `exec_sql` materializes from Postgres as today. Postgres is
  fed by the projection (§5). Freshness = webhook latency (target ≤1s; see §5).
- **Read-your-writes for SQL callers**: the semantic-update endpoint (§4) projects
  synchronously before it answers, so `INSERT` then `SELECT` from the console or MCP sees
  the row. Grid edits reach the SQL path a beat later; the console shows a "syncing" hint
  while the table's projection revision trails the doc revision (both are in the response).

## 4. Write paths

### Humans (grid)
Local ops via `LoroManager` → `createSyncEngine({ syncs: { wal, live } })` → sync-service
WS. Nothing new. Validation is client-side for UX (type, option label, link target) plus
projection-side as the guard (§5).

### Programs (SQL console, `QueryDatabase`, SDK `exec`)
`exec_sql` runs exactly as today up to the typed `Vec<RowChange>`. Instead of
`DatabasesRepo::apply_changes`, the service calls a new port:

```rust
/// Applies typed row changes to a table's CRDT document, atomically, at a known revision.
pub trait TableDocumentWriter {
    fn apply(&self, table: &TableSurface, changes: &[RowChange], expected: Option<Revision>)
        -> impl Future<Output = Result<Applied, DocumentWriteError>> + Send;
}
pub struct Applied { pub revision: Revision, pub inserted_row_ids: Vec<RowId>, pub applied: bool }
pub enum DocumentWriteError { Conflict { current: Revision }, Rejected(String), Unavailable(Report) }
```

The adapter POSTs to the sync-service (new DO route, §6.1):

```
POST /document/{tableSurfaceId}/database-update
{ expectedRevision?: string, changes: [ {op:"insert", rowId, cells, afterRowId?} | {op:"update", rowId, cells}
                                        | {op:"delete", rowId} | {op:"link"|"unlink", columnId, source, target} ],
  attribution: { actor, onBehalfOf } }
→ 200 { revision, applied: true } | 200 { revision, applied: false } (idempotent replay) | 409 { current }
```

The DO converts semantic changes to Loro ops (`rows.insert`, `cells.set`, …) as the
**server peer** (reserved id block, like `AI_PEER_BASE`), previews them on `doc.fork()`,
persists, broadcasts to WS peers, projects to DSS, then answers. This is the
`spreadsheet-update` contract with semantic ops instead of raw update bytes — so DSS never
links `loro` natively (today no Rust crate outside the wasm worker does) and the DO stays
the single writer for its doc.

`base_versions` / `read_versions` in the exec API become **revisions** (opaque strings =
encoded Loro version vectors). Omitted → last-write-wins per cell, as today. `ExecOutcome`
keeps its shape; `new_versions` carries the revisions.

## 5. Projection (sync-service → Postgres)

`database_rows`, `database_row_links`, `database_rows.position`, and
`database_tables.version` become a projection of the doc. The DO already pushes shallow
snapshots and `interaction` webhooks to DSS for documents; databases get a sibling:

```
PUT /internal/databases/tables/{tableId}/projection   (InternalOnly, from the DO)
{ revision, changedRowIds: [...], removedRowIds: [...], rows: { rowId: { cells, position } }, links: [...] }
```

- Incremental: the DO knows which containers changed on import (it already walks frontiers
  to attribute node ids for blame); it sends only touched rows. Full resync endpoint for
  recovery (`POST …/projection/full`, reads `GET /document/{id}/raw`).
- **Validation lives here** (this is where "validity against our own ideas" is enforced):
  a cell whose value doesn't fit its column (type, unknown option label, link target not a
  row of the configured table) is projected as `NULL` and recorded in a new
  `database_rows.invalid_cells JSONB` so the grid can badge it. CRDT updates are never
  rejected between peers — rejecting an already-applied local op breaks convergence — so
  the invariant is "Postgres/SQL never sees an invalid value", not "the doc never contains
  one".
- Every projection bumps `version`, publishes `database_table_changed` (unchanged liveness
  for chips/console), and writes activity as today.
- Latency: the DO's persistence alarm is 5s for documents; databases call the projection on
  every import with a ~300ms debounce (settable per doc kind), and synchronously from the
  semantic-update route.
- Idempotent by `revision` (the projection stores the last projected revision per table).

## 6. New server pieces (the only real backend work)

1. **sync-service `database-update` route + database doc kind** (`services/sync-service`):
   semantic-op applier with fork-preview validation, revision CAS, server-peer attribution,
   projection webhook, per-kind debounce. Reuse `spreadsheet.rs`'s ports
   (`SpreadsheetUpdatePort`/`Effects`) generalized to a `DocKind`.
2. **Projection ingress in DSS** (`crates/databases`): `PUT /internal/databases/tables/{id}/projection`
   → `DatabasesService::apply_projection` (validation, upsert rows/links/positions, bump
   version, publish). Plus `TableDocumentWriter` outbound adapter over `sync_service_client`.

Everything else is glue:

- `crates/collab_surface`: add `EntityType::Database` to `SUPPORTED_PARENT_TYPES`; add
  `SurfaceInitializer::initialize_from_snapshot(surface_id, bytes)` beside the markdown one
  (golden bytes for a new table; a built snapshot for backfill). `database_tables` gains
  `surface_id UUID` (FK `collab_surfaces`). Token = `Database` access level → `View` opens
  a read-only socket, `Edit/Owner` a writable one; column-level read-only (shared
  definitions, magic) is projection-enforced.
- `lexical-service`: `POST /databases/table-snapshot` (rows JSON → snapshot) for backfill,
  and `GET /databases/{surfaceId}/rows` if Rust ever needs to read a doc directly (the
  existing "TS reads the CRDT for Rust" pattern).
- `packages/databases-crdt`: schema, `cells` codec ↔ `PropertyValue`, client validation,
  awareness selection codec `{rowId, columnId}`.
- Frontend: `DatabaseGrid` binds to `LoroManager` state; `createCollabSurfaceSource`
  (already generic — comment in `helpers.ts` says so); presence outlines + avatars per cell
  (reuse `remote-cursor` styling); `UndoManager` on Ctrl+Z inside the grid; "syncing"
  indicator from `status()`.

## 7. Migration and rollout

- `databases.storage_mode TEXT CHECK IN ('postgres','crdt')`, default `postgres`. New
  databases behind `ENABLE_DATABASE_CRDT` are created `crdt`; the service dispatches
  `apply_changes` vs `TableDocumentWriter` on the mode. No dual writes.
- Backfill a `postgres` database: freeze writes (mode `migrating`), build a snapshot per
  table from its rows via `lexical-service`, `initialize_from_snapshot`, verify the
  projection round-trips byte-for-byte, flip to `crdt`. Reversible while the projection is
  complete (it always is).
- Delete: `collab_surface` soft-delete + the known "DO never reclaimed" gap (shared with
  every surface today).

## 8. Limits and risks

- **Table size.** A DO holds the doc in memory; ~20k rows × 10 columns ≈ 200k map entries
  is comfortable, 200k rows is not. Keep `MAX_MATERIALIZED_ROWS`-style caps per table
  (start 20k, warn at 10k) and shallow-snapshot compaction. Bigger tables stay `postgres`
  mode — the dispatch above makes that a per-database choice, not a fork of the code.
- **Two-hop latency for SQL after grid edits** (WS → DO → webhook → Postgres). Sub-second
  in practice; surfaced in the UI, never silent.
- **Validation is eventual.** A peer can see another peer's invalid value for a moment
  before the projection nulls it and badges the cell. Acceptable for humans; programs only
  see validated data.
- **Permission revocation** rides the 1h token TTL, as for documents.
- **Loro-in-Rust boundary.** Kept behind the DO on purpose; if the native sync path
  (`sync_machine`, another branch) lands, the same semantic-op applier moves there.
- **Schema/doc skew.** A client on an old `DatabaseDetail` writes a cell for a deleted
  column → projection drops it (orphan). `meta.schemaVersion` lets the grid refetch when
  behind.

## 9. Phases

| Phase | Work | Size |
|---|---|---|
| 0 | Decide per-table docs + plain-value text cells; `packages/databases-crdt` schema/codec/validation + golden snapshot; `TableDocumentWriter` + projection ports in `crates/databases` (fakes + tests) | 2 days |
| 1 | sync-service: database doc kind, `database-update` route, projection webhook (ports + DO adapters, unit + worker tests) | 4–5 days |
| 2 | DSS: `collab_surface` Database parent + snapshot initializer, `surface_id` migration, projection ingress + validation, `storage_mode` dispatch, `exec` over the writer | 4–5 days |
| 3 | Web: grid on `LoroManager`, presence, undo, offline, syncing indicator; `lexical-service` snapshot builder | 5 days |
| 4 | Backfill tooling, caps/compaction, load test (2 peers × 20k rows), docs/agent guide | 2–3 days |
| later | LoroText cells; schema in the doc if columns need multiplayer too; native sync path | — |

Roughly three to four weeks for one engineer driving agents, with phases 1–3 parallel
after phase 0 fixes the contracts.

## 10. Decisions needed

1. Per-table doc (recommended) vs per-database doc.
2. Text cells as plain LWW values in v1 (recommended) vs LoroText from day one.
3. SQL writes land in the DO via semantic ops (recommended) vs DSS linking `loro` natively.
4. Validation at projection with badged invalid cells (recommended) vs client-only.
5. Whether to run both storage modes indefinitely (recommended: yes, keyed per database)
   or force-migrate everything once stable.
