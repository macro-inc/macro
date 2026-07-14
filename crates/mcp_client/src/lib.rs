#![deny(missing_docs)]
//! MCP client library for web-based MCP server integration.

/// Domain layer: models, ports, and service.
pub mod domain;

/// Inbound adapters (HTTP/axum).
pub mod inbound;

/// Outbound adapters (Postgres).
pub mod outbound;
