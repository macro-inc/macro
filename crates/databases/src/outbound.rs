//! Driven adapters: Postgres persistence, the rusqlite executor, magic-table
//! sources, and the table-event publisher.

#[cfg(feature = "postgres")]
pub mod pg_databases_repo;

#[cfg(feature = "sqlite")]
pub mod rusqlite_executor;

pub mod magic;

pub mod redis_event_publisher;
