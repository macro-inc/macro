#![deny(missing_docs)]
//! MCP client library for web-based MCP server integration.

/// Domain layer: models, ports, and service.
pub mod domain;

/// Address-guarded HTTP clients for user-chosen MCP servers.
pub mod guarded_http;

/// Inbound adapters (HTTP/axum).
pub mod inbound;

/// Outbound adapters for OAuth, Postgres, and Redis.
pub mod outbound;
