#![deny(missing_docs)]
//! Macro Databases: user-facing tables of typed rows, queried and mutated
//! through SQL, following the hexagonal architecture pattern.
//!
//! A database is a collection of tables (tabs). Columns are bindings to
//! `models_properties` property definitions, so the existing property type
//! system (data types, select options, entity references) carries directly
//! over; cells are [`models_properties::service::PropertyValue`]s stored as
//! JSONB per row. Entity cells store references only — display data is
//! hydrated at read time.
//!
//! # The SQL-first surface
//!
//! There are no cell/row/link CRUD endpoints. The public write and read verb
//! is SQL, executed against a per-request, permission-scoped, **in-memory
//! SQLite materialization** of exactly the tables the statement references:
//!
//! 1. Build the viewer's catalog (their tables + junction views + magic tables).
//! 2. Prepare the statement against a schema-only SQLite; the authorizer
//!    callback yields the referenced tables and columns.
//! 3. Materialize only those, permission-scoped, with the property model
//!    compiled to constraints (`STRICT`, `CHECK` from select options, foreign
//!    keys from links) so SQLite itself enforces validity.
//! 4. Execute inside a transaction with a session recording the changeset.
//! 5. Translate the changeset back into typed domain commands and apply them
//!    to Postgres — the single write path shared with every other surface.
//!
//! Postgres is the only source of truth; the SQLite database is discarded
//! after every request. Schema operations (create database/table/column)
//! remain small structured endpoints because property definitions carry
//! configuration DDL cannot express.
//!
//! # Architecture
//!
//! - **domain**: models, ports, and the service implementation (all policy).
//! - **inbound**: the Axum router (SQL exec, snapshot download, schema ops).
//! - **outbound**: Postgres repositories, the rusqlite executor, magic-table
//!   sources, and the table-event publisher.

pub mod domain;

#[cfg(feature = "inbound")]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;
