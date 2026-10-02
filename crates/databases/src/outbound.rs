//! Driven adapters: Postgres persistence, cells through the properties
//! adapter, and the table-event publisher.

pub mod entity_access_directory;

#[cfg(feature = "postgres")]
pub mod pg_databases_repo;

#[cfg(feature = "postgres")]
pub mod pg_definition_store;

/// The per-user starter claim of the cell store's batches.
#[cfg(feature = "postgres")]
pub(crate) mod pg_starter;

#[cfg(feature = "postgres")]
pub mod pg_cell_store;

#[cfg(feature = "gateway")]
pub mod gateway_event_publisher;
