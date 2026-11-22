//! Native MCP servers: users connect remote MCP servers directly, over
//! OAuth (or a linked account), and the AI loop dials them in process.

/// Domain layer: models, ports, and service.
pub mod domain;

/// Inbound adapters (HTTP/axum).
pub mod inbound;

/// Outbound adapters for OAuth, Postgres, and Redis.
pub mod outbound;
