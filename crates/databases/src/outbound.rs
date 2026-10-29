//! Driven adapters: Postgres persistence, cells through the properties
//! adapter, and the table-event publisher.

pub mod entity_access_directory;

#[cfg(feature = "postgres")]
pub mod pg_databases_repo;

#[cfg(all(feature = "postgres", feature = "view_rows"))]
pub mod pg_view_rows;

#[cfg(feature = "postgres")]
pub mod pg_definition_store;

/// Atomic starter database persistence.
#[cfg(feature = "postgres")]
pub mod pg_starter;

#[cfg(feature = "postgres")]
pub mod pg_cell_store;

#[cfg(feature = "gateway")]
pub mod gateway_event_publisher;
