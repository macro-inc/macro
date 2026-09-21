//! Driven adapters: Postgres persistence, the rusqlite executor, magic-table
//! sources, and the table-event publisher.

#[cfg(feature = "postgres")]
pub mod pg_access_directory;

#[cfg(feature = "postgres")]
pub mod pg_databases_repo;

#[cfg(feature = "postgres")]
pub mod pg_definition_store;

/// Atomic starter database persistence.
#[cfg(feature = "postgres")]
pub mod pg_starter;

#[cfg(feature = "sqlite")]
pub mod rusqlite_executor;

#[cfg(feature = "postgres")]
pub mod magic;

#[cfg(feature = "gateway")]
pub mod gateway_event_publisher;

#[cfg(all(feature = "postgres", feature = "sqlite"))]
pub mod build;

#[cfg(all(feature = "postgres", feature = "sqlite"))]
pub use build::{build_service, build_service_with_limits, executor_limits_from_env};
