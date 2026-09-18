//! Transport adapters for preview use cases.
/// Authenticated Macro control routes.
pub mod control;
/// Root-mounted HTTP and WebSocket gateway.
pub mod http;
/// SSH listener accepting only the provisioned remote forward.
pub mod ssh;
/// Internal session-scoped MCP server.
pub mod toolset;
