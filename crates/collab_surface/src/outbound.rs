//! Outbound (driven) adapters for collab surfaces.

#[cfg(feature = "postgres")]
pub mod pg_collab_surface_repo;
pub mod surface_init;
