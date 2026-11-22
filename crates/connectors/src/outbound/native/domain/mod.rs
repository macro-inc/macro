/// Domain models for MCP server connections and tool execution.
pub mod models;
/// Port traits consumed by the domain service.
pub mod ports;
/// Registry for MCP servers with pre-registered OAuth credentials.
#[cfg(feature = "providers")]
pub mod provider_registry;
/// Service orchestration for MCP connections and tool calls.
pub mod service;
