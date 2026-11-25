//! Outbound (driven) adapters for favorites.

#[cfg(feature = "postgres")]
pub mod merge;
#[cfg(feature = "postgres")]
pub mod pg_favorites_repo;
