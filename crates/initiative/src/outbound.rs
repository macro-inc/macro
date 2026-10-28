//! Outbound (driven) adapters for initiatives.

#[cfg(feature = "resources")]
pub mod resources;

#[cfg(feature = "postgres")]
mod pg_initiative_repo;

#[cfg(feature = "postgres")]
pub use pg_initiative_repo::PgInitiativeRepo;
pub mod event_publisher;

#[cfg(feature = "resources")]
mod assignees;
