//! Domain logic for the MCP OAuth broker.

/// Domain models for broker-managed OAuth state and request payloads.
pub mod models;
/// Domain ports for upstream OAuth, product passwordless, and state storage.
pub mod ports;
/// Domain service for the MCP OAuth broker.
pub mod service;
