# Database backend

Databases contain tables of typed rows. PostgreSQL stores the authoritative data;
user SQL runs in a temporary, permission-scoped SQLite database. Column placements
bind to the existing property definitions and value types.

## Query and mutation flow

1. The domain service builds the caller's catalog from accessible databases and
   sources. SQL names resolve through this catalog.
2. SQLite analyzes the statement against the schema to identify its dependencies.
   Only the referenced tables are materialized, with typed constraints and links.
3. The executor runs within statement, time, result-size, and change-count limits.
   Read-only queries reject writes.
4. For writes, SQLite records a changeset. The domain translates it into typed
   commands and validates the affected rows and relationships.
5. The PostgreSQL repository applies the changes atomically with table-version
   guards. Stale versions, changed bindings, and trashed parents reject the write.
6. Successful commits publish their versions and change notifications. SQLite is
   discarded after the request.

## Review map

| Concern | Implementation |
| --- | --- |
| Domain contracts and orchestration | `src/domain/models.rs`, `ports.rs`, `service.rs` |
| Catalog and typed materialization | `src/domain/catalog.rs`, `materialize.rs`, `sugar.rs` |
| Bounded SQL execution | `src/outbound/rusqlite_executor.rs` |
| Changeset validation and writeback | `src/domain/translate.rs`, `src/outbound/pg_databases_repo.rs` |
| Column casts and inference | `src/domain/service/columns.rs`, `column_types.rs`, `infer_column_type.rs` |
| Saved views, sharing, imports, starter data | Corresponding modules under `src/domain/` |
| HTTP transport | `src/inbound/axum_router.rs`, `starter_router.rs` |
| Service construction and notifications | `src/outbound/build.rs`, `gateway_event_publisher.rs` |

Authorization and business policy live in domain services. HTTP adapters obtain
typed access receipts and pass requests inward. Persistence adapters implement
domain ports, including transaction and locking requirements.

The document storage service exposes schema operations and the SQL-first
`/databases/query` and `/databases/exec` endpoints. The SDK provides database,
table, and column handles, queries, mutations, imports, and snapshot downloads.

## Validation

Run from the repository root inside Nix, with a migrated local PostgreSQL database
and `SQLX_OFFLINE` unset:

```sh
cargo test -p databases --all-features
```

The suite covers permission scoping, read-only enforcement, executor limits,
typed round trips, relations, safe casts, rollback, stale/concurrent writes,
sharing, saved views, and retry-safe import/starter provisioning. SQLx tests
create isolated databases using the repository migrator.
