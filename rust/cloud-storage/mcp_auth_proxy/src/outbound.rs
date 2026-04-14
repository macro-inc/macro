//! Outbound adapters for the MCP OAuth broker.

/// FusionAuth-backed upstream OAuth provider.
pub mod fusionauth;
/// Redis-backed in-flight OAuth state store.
pub mod redis;
