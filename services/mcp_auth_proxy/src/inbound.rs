//! Inbound adapters for the MCP OAuth broker.

/// Path the shared gateway forwards without stripping.
pub(crate) const GATEWAY_PATH_PREFIX: &str = "/mcp";

/// Axum router for the MCP OAuth broker.
pub mod axum_router;
/// User API key and JWT bearer middleware for the protected MCP endpoint.
pub mod middleware;
