/// Axum HTTP adapter for MCP server management and OAuth callbacks.
pub mod axum_router;
/// AI tools over the user's custom MCP servers.
pub mod toolset;

pub use axum_router::{McpRouterState, mcp_oauth_callback_router, mcp_router};
