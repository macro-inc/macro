//! Outbound adapters for entity access management.
//!
//! These modules contain concrete implementations of the domain ports.

mod pg_repo;

pub use pg_repo::PgRepository;
