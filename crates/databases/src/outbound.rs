//! Driven adapters: Postgres persistence, the rusqlite executor, magic-table
//! sources, and the table-event publisher.

#[cfg(feature = "postgres")]
pub mod pg_access_directory;

#[cfg(feature = "postgres")]
pub mod pg_databases_repo;

#[cfg(feature = "postgres")]
pub mod pg_definition_store;

#[cfg(feature = "sqlite")]
pub mod rusqlite_executor;

#[cfg(feature = "postgres")]
pub mod magic;

#[cfg(feature = "gateway")]
pub mod gateway_event_publisher;
