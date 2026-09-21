# Storage

Postgres (MacroDB) is the only source of truth. SQLite never stores anything (see
[query-engine.md](query-engine.md)). Design rule: Postgres's job is storage, permissions,
and transactions — deliberately boring. Querying happens elsewhere, so we don't need
per-cell indexing tricks here.

## Schema

```sql
-- the entity users see ("Summer Offsite") — one row per database
CREATE TABLE databases (
  id          TEXT PRIMARY KEY,          -- db_...
  name        TEXT NOT NULL,
  owner_id    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  trashed_at  TIMESTAMPTZ
);

-- tabs
CREATE TABLE database_tables (
  id          TEXT PRIMARY KEY,          -- tbl_...
  database_id TEXT NOT NULL REFERENCES databases(id),
  name        TEXT NOT NULL,
  position    TEXT NOT NULL,             -- fractional index for tab order
  version     BIGINT NOT NULL DEFAULT 0  -- bumped on any row/column change
);

-- columns = placement metadata over property_definitions (see "Columns are bindings")
-- The column's name, data_type, multi-select flag, and options all live on the bound
-- property_definitions row; this table only says where it appears.
CREATE TABLE database_columns (
  id                     TEXT PRIMARY KEY,   -- col_...
  table_id               TEXT NOT NULL REFERENCES database_tables(id),
  property_definition_id UUID NOT NULL,      -- FK to property_definitions
  position               TEXT NOT NULL,
  config                 JSONB               -- link target {database_id, table_id}, lookup {via, target}, width
);

-- rows: one Postgres row per user row, cells as one JSONB object
CREATE TABLE database_rows (
  id         TEXT PRIMARY KEY,           -- row_...
  table_id   TEXT NOT NULL REFERENCES database_tables(id),
  position   TEXT NOT NULL,
  cells      JSONB NOT NULL,             -- { "col_a": {"t":"string","v":"..."}, "col_b": {"t":"entity","v":"usr_.."} }
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- link columns get a real junction, not JSONB arrays
CREATE TABLE database_row_links (
  link_column_id TEXT NOT NULL REFERENCES database_columns(id) ON DELETE CASCADE,
  source_row_id  TEXT NOT NULL REFERENCES database_rows(id) ON DELETE CASCADE,
  target_row_id  TEXT NOT NULL REFERENCES database_rows(id) ON DELETE CASCADE,
  position       TEXT,
  PRIMARY KEY (link_column_id, source_row_id, target_row_id)
);
```

Indexes: `database_rows(table_id)`, `database_row_links(target_row_id)` (reverse-link
lookups), `database_columns(table_id)`.

## Why JSONB cells per row, not EAV

`entity_properties` is EAV (one row per entity×property) — right for sparse annotations
across millions of heterogeneous entities. Database cells are the opposite: dense, always
read and written together. One JSONB object per row means:

- Fetching a table for materialization is one sequential scan
  (`SELECT id, cells FROM database_rows WHERE table_id = $1`).
- A row write is one UPDATE.
- The shape matches what both the grid and the SQLite materializer consume.

We give up per-cell Postgres indexing, which we don't need because user SQL runs in
SQLite. Do NOT shove rows into `entity_properties`; the access patterns are opposite.

## Cell value encoding

**A cell IS a `models_properties::service::PropertyValue`** — the existing serde tagged
union (`{"type": "EntityReference", "value": [...]}`), reused verbatim:
`cells = { "<property_definition_id>": PropertyValue }`. Consequences, confirmed against
the code:

- Write path reuses `SetPropertyValue` + `validate_compatibility(data_type,
  is_multi_select)` (`models_properties/src/api/requests.rs`) unchanged — zero new
  validation code.
- Select values are **option UUIDs**, not display strings (resolved via
  `property_options`); the SQLite materializer joins options to expose display values.
- Entity cells store `EntityReference { entity_type, entity_id, specific_message_id? }` —
  the type rides *next to* the id (no id-prefix sniffing); renderer and materializer key
  off `entity_type`. No denormalized names/titles ever — display data is hydrated at read
  time (chips in UI, magic-table joins in SQL), so staleness is impossible.
- **Bare cells**: `{"t":"bare","v":"Priya's partner"}` — text where an entity could be.
  Hydration (⌘↵) swaps the text for a freshly minted entity id. Joins skip bare cells
  naturally (no id, nothing to join).

Tombstones: never garbage-collect ids from cells when an entity is deleted — the chip
renders a "deleted" ghost, joins drop it, and trash-restore brings it back.

## Columns are bindings

A column IS a `property_definitions` row; `database_columns` holds only placement
(table, position, link/lookup config). Name, `data_type`, `is_multi_select`, and options
all live on the definition, so options/colors/tag machinery/promotion are shared code and
shared tables, not copies. The only new storage in the whole feature is the *value* side
(`database_rows.cells` replacing EAV `entity_properties` for row-local values).

- **Default**: creating a column creates a `property_definitions` row scoped to the
  database — add a `Database { database_id }` variant to `PropertyOwner`
  (`models_properties/src/shared/property_owner.rs`, currently `User | Team | System`);
  the team-scoping migration (`20260622223029_kill_org_properties_add_team.sql`) is the
  precedent for adding an owner dimension. Two databases with a "Status" column don't
  collide.
- **Bind**: the column picker also offers existing workspace/team definitions.
- **Promote**: a database-scoped definition can be promoted later —
  `crates/properties/src/outbound/tag_promotion_queries.rs` is the working precedent.

Semantics that fall out: the same entity in two databases has *different* statuses if the
columns are database-scoped, the *same* status if both bind to a shared definition.

**The payoff junction**: when a row references an entity and its column is bound to a
shared definition, the cell reads/writes `entity_properties` for that entity — edit a
task's "Due date" in the database and it changes in the Tasks module, the side panel,
everywhere. A database over entities is largely a view over the properties they already
have; database-scoped columns layer collection-local data on top.

## Entity plumbing checklist

`EntityType::Database` in `crates/model-entity/src/lib.rs` — the blast radius is ~26 files
of exhaustive matches (trace `EntityType::Reminder` / `EntityType::AgentSession`, the two
most recent additions). Highlights:

- `model-entity` (`is_valid_entity_access_entity` — yes, permissions come from
  `entity_access`), `graphql_common`, `models_soup::SoupItem`,
  `models_properties::EntityType` + the `property_entity_type` PG enum,
  `models_opensearch` (or start Postgres-only like `CrmCompanies`), soup `ItemType`.
- New domain crate `crates/databases/` — hexagonal layout per
  `.claude/skills/cloud-storage-hexagonal-architecture`; `crates/reminders/` is the
  smallest complete worked example to copy (domain/ports/service, outbound pg repo,
  inbound axum router + toolset, feature flags mirroring `crates/projects/Cargo.toml`).
- Permissions: `entity_access` table + a new axum extractor in
  `crates/entity_access/src/inbound/axum_extractors/`; handlers take
  `EntityAccessReceipt<T>` and never branch on access level.
- Generic mutations: implement `RenameEntity`/`MoveEntity`/`TrashEntity`/… capability
  traits in `crates/entity_mutation`; register in
  `services/document_storage_service/src/service/entity_mutation.rs`. Gets
  rename/trash/share/move-to-project for free.
- Routes mount into document_storage_service's router composition
  (`services/document_storage_service/src/api.rs`).
- Migrations: `sqlx migrate add` in `crates/macro_db_client` (paired .up/.down), then
  `nix develop --command just prepare_db` from repo root.
- SDK: `packages/sdk/src/entities/databases/` per the add-sdk-endpoint skill; `just
  coverage` enforces it.

## Open items

- Sharing granularity: v1 shares the database; tables/rows inherit. Per-table sharing is a
  possible v2 (schema supports it — entity_access rows against table ids).
- Whether `database_rows.cells` wants a GIN index for admin/debug tooling (not for the
  product query path).
- Fractional-index library choice for `position` (check what soup/tasks ordering uses).
