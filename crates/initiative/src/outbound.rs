//! Outbound (driven) adapters for initiatives.

#[cfg(feature = "postgres")]
mod pg_initiative_repo;

#[cfg(feature = "postgres")]
pub use pg_initiative_repo::PgInitiativeRepo;
