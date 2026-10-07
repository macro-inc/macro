# Database backend

Databases contain tables of typed rows. Cells use the properties system's
`DATABASE_ROW` discriminator, and column placements bind to existing property
definitions and value types. Rows of an app database participate as entities;
rows of core storage alone do not acquire app access. There is one cell store.

## Storage and app entities

Each `databases` row identifies reusable storage. Tables, column definitions, views,
saved queries, rows and their cells belong to that resource. A resource has no
app name, owner, or trash state and can exist without any Macro entity.

An optional `database_entities` row holds the app metadata: `name`, `user_id` (the owner),
`created_at`, `updated_at`, and `trashed_at`. Its `database_id` is both its primary
key and a foreign key to `databases.id`. The app uses that shared identity for
routes, grants, references and API responses. `Database` remains the app-facing
Rust model. Soup discovery and database/row access require this entity; merely
creating core storage does not make it a shareable Macro database.

This is the first use of the plural `<kind>_entities` convention for databases.
New app entities should follow it, keeping reusable technology separate from
app ownership and lifecycle. Existing unrelated entities are not renamed.
Collaboration surfaces are a similar reusable resource; this change does not
turn them into entities or change their parent-based access model.

`DatabaseStorage` exposes allocation, validated storage batches, and deletion
without app metadata. A future CRM domain can hold its own reference to a core
database and authorize access through its own service. Its composition root
supplies the storage adapter. The port is trusted persistence, not a new public
API: consumers validate their own commands and authorize their own resources.
The Macro database service creates its entity and owner grant atomically through
its repository and uses `CellStore` to hold the entity's lifecycle lock during writes.
Both paths use the same transaction engine, table versions, cells and journal.
An app entity's foreign key prevents deleting its storage through the core port.

The migration is a destructive cutover: it discards existing database content,
grants, saved queries, journal entries, and starter markers, then removes app
metadata from `databases`. Deploy it with the updated service; old binaries are
not supported. Rollback also discards database content.

Deleting an app entity (including through owner deletion) cleans up its owned
storage, journal, and grants. Storage deletion cascades to tables, definitions,
and cells. The core storage adapter purges its journal in the same transaction.

## Reads and writes

1. Rows are read as Soup items, scoped to the databases the caller can reach as
   `entity_access` answers it.
2. Every write to a database's schema or data is one batch of typed ops
   (`models_databases::DatabaseOp`, `POST /databases/{id}/ops`,
   `DatabasesService::apply_ops`), grouped by the resource they change. Each op
   is `{kind, <ids>, change: {kind, ...}}`:

   | Op `kind` | Names | `change.kind` |
   | --- | --- | --- |
   | `table` | `table` | `create`, `rename`, `delete`, `reorder_columns`, `reorder_views` |
   | `column` | `table`, `column` | `create`, `rename`, `change_type`, `delete`, `add_options`, `update_option`, `delete_option` |
   | `rows` | `table` | `insert`, `update`, `delete` |
   | `view` | `table`, `view` | `create`, `update`, `delete`, `move_card` |
   | `reorder_tables` | (every table, as `order`) | none |

   Ops are checked against the receipt's database and apply in order in one
   transaction, all or nothing; any refusal writes nothing. Lists are ordered
   by fractional keys (`models_databases::position`), stored `COLLATE "C"`.
3. Each op answers one `models_databases::OpResult`, in the order sent, grouped
   the same way: the result's outer `kind` is its op's, it echoes the op's ids
   with the table's version after the commit (`tableVersion`, left out when
   the table was deleted), and its `change` says what happened, in the past
   tense:

   | Result `kind` | `change.kind` |
   | --- | --- |
   | `table` | `created`, `renamed`, `deleted`, `columns_reordered`, `views_reordered` (with the views' `positions`) |
   | `column` | `created`, `renamed`, `type_changed`, `deleted`, `options_added` (with the ids `added`), `option_updated`, `option_deleted` |
   | `rows` | `inserted` (with the new `rows`), `updated` and `deleted` (with how many were `affected`) |
   | `view` | `created` and `updated` (with the stored `view`), `deleted`, `card_moved` (with the written `positions`) |
   | `reorder_tables` | none; `tables` lists every table with its version |

   Results are grouped like the ops because a caller, and the coming change
   journal with undo, pairs each result with its op by index and kind, with no
   second lookup table from op kinds to result kinds. The flat result list had
   already started grouping ad hoc: one `rows_written` answered all three row
   ops, one `option_changed` answered both option edits, and one
   `view_written` answered both view writes.
4. Later ops of a batch see what earlier ops did. New tables, columns, options
   and views carry ids the client mints (UUIDv7), so a later op can name a
   table, column, option or view the same batch created: create a table, give
   it columns, then insert rows into them, in one request. An id that already
   names something, or is minted twice in one batch, refuses the batch with a
   400 whose `taken` is `{kind: "table" | "column" | "option" | "view", id}`; a
   retry of a committed batch lands there instead of writing twice. Rows keep
   server-minted ids, answered in the `inserted` result.
5. The optional request-level `baseVersions` names tables and the version the
   caller read; a table at another version answers 409 and writes nothing. A
   column type change follows one cast rule for the type menu, the agent tool
   and `ALTER COLUMN`: it converts every value or refuses with the count and a
   few quoted misfits. Data is only destroyed by an explicit delete of a cell,
   row, column, table or option; an unknown option label is refused, never
   created. To keep the original, the conversion read
   (`POST /databases/{id}/tables/{table_id}/columns/{column_id}/conversion`,
   `DatabasesService::column_conversion`) answers the values that convert, the
   option labels they need and how many do not; the client then sends one
   batch: a column `create` after the original, then a rows `update` with those
   values, at the conversion's table version.
6. Successful commits publish their versions and change notifications.

SQL lives outside this crate. The browser compiles statements with the
`database_sql` engine and posts the ops it emits; agents run the same engine
through the `databases_sql` adapter, which reads through Soup and writes
through `apply_ops`.

## Review map

| Concern | Implementation |
| --- | --- |
| Domain contracts and orchestration | `src/domain/models.rs`, `ports.rs`, `service.rs` |
| Catalog entries | `src/domain/catalog.rs` |
| Typed ops | `src/domain/service/ops.rs`, `models_databases` |
| Rows, cells, imports, and column definitions | `src/outbound/pg_databases_repo.rs`, `pg_cell_store.rs`, `pg_definition_store.rs` |
| Table, column and cell ops | `src/domain/service/ops/tables.rs`, `columns.rs`, `cells.rs`, `src/outbound/pg_databases_repo/schema.rs` |
| Column casts and inference | `src/domain/service/casts.rs`, `column_types.rs`, `infer_column_type.rs` |
| Typed views and a board's card places | `models_databases::views`, `src/domain/service/ops/views.rs`, `src/outbound/pg_databases_repo/views.rs` |
| Saved queries, sharing, imports, starter data | Corresponding modules under `src/domain/` |
| HTTP transport | `src/inbound/axum_router.rs`, `starter_router.rs` |
| Service construction and notifications | `src/outbound/build.rs`, `gateway_event_publisher.rs` |

Authorization and business policy live in domain services. HTTP adapters obtain
typed access receipts and pass requests inward. Persistence adapters implement
domain ports, including transaction and locking requirements.

The document storage service mounts the routes. Writes inside a database go
through `POST /databases/{id}/ops`; the other routes are the database list and
detail, create, starter, CSV import, a board's card positions, a column's casts
and type inference, awareness, permissions and saved queries.

## Validation

Run from the repository root inside Nix, with a migrated local PostgreSQL database
and `SQLX_OFFLINE` unset:

```sh
cargo test -p databases --features postgres,inbound,ai_tools,gateway,entity_mutation
```

The suite covers permission scoping, typed round trips, relations, safe casts,
rollback, stale/concurrent writes, sharing, typed views and card moves, and
retry-safe import/starter provisioning. SQLx tests create isolated databases
using the repository migrator.

### Required columns

A trusted host can create a column with `Column.nullable = false` through
`DatabaseStorage::apply_storage_writes`. Existing columns and ordinary user-created
columns default to nullable. This does not add a UI toggle for requiredness.

The planner rejects omitted required cells on insert and explicit clears on edit.
Both write ports also check affected required cells in the final transaction state
under table locks, including schema changes and undo. A batch can add a required
column and populate existing rows atomically. Empty selections, entity-reference
lists and link lists are absent; empty text, zero and false are present. Undo
restores the column setting alongside its cells.

Enforcement belongs to the Rust database engine. Direct SQL and writes through
unrelated property APIs bypass it; the migration only adds the nullable flag.
