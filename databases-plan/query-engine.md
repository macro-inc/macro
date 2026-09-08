# Query engine

**Ephemeral, in-process SQLite per query.** Postgres owns the data; SQLite is the query
engine. `rusqlite`, `:memory:`, no network, no daemon, no files. This is what makes
"arbitrary SQL" implementable in a week: we never write a parser, a planner, or a sync
pipeline — and user SQL never touches Postgres.

## Lifecycle of a query

For `SELECT p.email FROM guests g JOIN people p ON p.id = g.guest WHERE g.status = 'Going'`:

1. **Open** `Connection::open_in_memory()` (~10–50µs — it's a malloc, not a database
   server).
2. **Prepare against a schema-only catalog**: every table the user can see (their database
   tables, junction views, magic tables) declared with columns but no data. Prepare
   failure → return SQLite's error verbatim (that's the chip's "broken query" state; the
   errors are good).
3. **Discover dependencies**: SQLite's authorizer callback reports exactly which tables
   *and columns* the statement reads. No hand-rolled SQL parsing. This set is also the
   liveness dependency graph (see [liveness.md](liveness.md)).
4. **Materialize only what's referenced**, permission-filtered for the requesting user:
   - user tables: `SELECT id, cells FROM database_rows WHERE table_id = $1`, JSONB
     unpacked into columns per `property_data_type`;
   - junction views: straight from `database_row_links`;
   - magic tables: their blessed queries (see [magic-tables.md](magic-tables.md)),
     projected to only the referenced columns.
   Bulk-insert in one transaction. Human-scale tables → single-digit ms.
5. **Execute with guardrails**: read-only connection; authorizer denies everything except
   SELECT on the materialized set; `sqlite3_interrupt` on a ~100ms timeout; row and
   result-size caps.
6. **Return typed results**: column provenance from the prepare step tags result columns
   ("came from `people.id`" → entity type `user`) so the frontend hydrates chips.
7. **Drop it.** Nothing persists.

Cost budget per query: open ~µs · Postgres fetch 1–5ms (dominates; we were paying it to
render the table anyway) · bulk insert ~2–5ms for ~5k rows · execute µs–ms. Cost scales
with the tables the query touches, not with user or database count.

## Security model

The blast radius of arbitrary user/AI SQL is a scratch database containing only data the
user was already allowed to read. Permissioning is **structural**: each viewer's scratch
DB is materialized from their view of the world, so there is no per-row permission check
inside SQL to get wrong, and the same shared chip legitimately returns different results
for different viewers.

## Type mapping

| property_data_type | SQLite | notes |
|---|---|---|
| String / Link(URL) | TEXT | |
| Number | REAL | |
| Boolean | INTEGER | 0/1 |
| Date | TEXT | ISO-8601; SQLite date functions work |
| Select / Tag (single) | TEXT | option display value |
| Select / Tag (multi) | TEXT JSON array | + junction view |
| Entity (single) | TEXT | typed id, provenance-tagged |
| Entity (multi) / link column | TEXT JSON array | + junction view `t__col(row_id, linked_id)` |
| lookup / rollup | not materialized | desugared into the SQL (see links-and-lookups.md) |

Junction views keep joins flat and hand-writable; the raw JSON array coexists for
`json_each` power users.

Note (from the properties code): select/tag cells store **option UUIDs**, and entity cells
store `EntityReference` objects — the materializer resolves options to their display
values (join `property_options` during the Postgres fetch) and projects entity refs to
their ids, tagging the SQLite column with the `entity_type` for result provenance. Users
write `status = 'Going'`, never option ids.

## Sugar

Ruthlessly minimal — AI writes the long tail, sugar is for queries humans read:

- `expr HAS value` → membership test on a multi-valued column, desugars to
  `EXISTS (SELECT 1 FROM json_each(expr) WHERE value = ...)` (or a junction-view
  semijoin when the planner can). The single most common predicate on entity columns.
- That's it for v1.

Applied as a text-level rewrite before prepare; the readout always shows the sugared form,
"expand" shows the desugared form.

## Writes

Rejected in v1 at the authorizer, with an error pointing to SDK helpers
(`macro.dbs.byName(...).insert(...)`) that go through the normal Rust mutation path
(activity, permissions, notifications, version bumps). Later: updatable-view semantics
using the Postgres traceability rule — a result column is writable iff it maps to a single
base column with no expressions/aggregates. Same rule powers write-through view blocks.

## Caching (deferred until profiling says so)

- Key: `(user_id, sorted table ids, their version counters)` → a warm materialized
  in-memory DB. A doc with five chips over `guests` builds once.
- Batch: run all of a doc's chips against one materialization in one request.
- Only much later: long-lived incrementally-maintained per-user SQLite — the point where
  the Turso/DO conversation reopens, with data.

## Where it runs

CPU-bound, stateless → start inside document_storage_service (one new route:
`POST /databases/query` with `{sql}` → `{columns: [{name, type, entityType?}], rows,
deps, versions}`), trivially extractable to its own service later.

## Not doing

- Turso / per-user persistent SQLite files as storage — breaks sharing (whose file?),
  breaks cross-database refs and magic-table joins (no cross-instance JOIN), creates a
  Postgres→SQLite sync pipeline for permissions and magic data, new ops surface, new
  client stack. Nothing in the v1 design leaks the storage engine to users, so this stays
  reversible forever.
- SQL-to-Postgres transpilation — subset semantics, endless edge cases, and it points user
  SQL at the production database.
