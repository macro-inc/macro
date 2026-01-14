//! Outbound adapters for entity access.
//!
//! These modules contain concrete implementations of the domain ports.

mod pg_access_repo;

pub use pg_access_repo::PgAccessRepository;
