//! Outbound adapters for bots.

#[cfg(feature = "realtime")]
/// Connection-gateway publisher for changed bot profiles.
pub mod connection_gateway_profiles;
/// Postgres bot repository.
pub mod pg_bots_repo;
