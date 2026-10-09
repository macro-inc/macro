//! Domain logic for the MCP OAuth broker.

/// Domain models for broker-managed OAuth state and request payloads.
pub mod models;
/// Domain port traits for upstream OAuth providers and broker state stores.
pub mod ports;
/// Policy for the redirect URIs the broker will deliver codes to.
pub mod redirect_uri;
/// Domain service for the MCP OAuth broker.
pub mod service;
