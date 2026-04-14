//! Inbound adapters for the MCP OAuth broker.

/// Axum router for the MCP OAuth broker.
pub mod axum_router;
/// Bearer token middleware for the protected MCP endpoint.
pub mod middleware;
