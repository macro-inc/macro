//! Outbound adapters for the MCP OAuth broker.

/// FusionAuth-backed upstream OAuth provider.
pub mod fusionauth;
/// Authentication service-backed product passwordless provider.
pub mod passwordless;
/// Redis-backed in-flight OAuth state store.
pub mod redis;
