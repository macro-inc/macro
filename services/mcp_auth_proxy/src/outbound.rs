//! Outbound adapters for the MCP OAuth broker.

/// FusionAuth-backed upstream OAuth provider.
pub mod fusionauth;
/// Postgres-backed store for all broker state.
pub mod postgres;
/// Redis-backed store the broker used before Postgres; read during the cutover.
pub mod redis;
/// Postgres store of record that falls back to Redis during the cutover.
pub mod redis_cutover;
