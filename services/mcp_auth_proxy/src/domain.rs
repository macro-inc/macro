//! Domain logic for the MCP OAuth broker.

/// Domain models for broker-managed OAuth state and request payloads.
pub mod models;
/// Domain port traits for upstream OAuth providers.
pub mod ports;
/// Domain service for the MCP OAuth broker.
pub mod service;
