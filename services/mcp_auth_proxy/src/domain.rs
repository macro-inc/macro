//! Domain logic for the MCP OAuth broker.

/// Which registered client each issued access token went to.
pub mod access_token_clients;
/// The secret tying an OAuth handshake to the browser that started it.
pub mod browser_binding;
/// Domain models for broker-managed OAuth state and request payloads.
pub mod models;
/// Domain port traits for upstream OAuth providers and broker state stores.
pub mod ports;
/// Policy for the redirect URIs the broker will deliver codes to.
pub mod redirect_uri;
/// The MCP servers the broker issues tokens for.
pub mod resource;
/// Domain service for the MCP OAuth broker.
pub mod service;
