//! Runtime-agnostic MCP server support for providing MCP tools over ACP.
//!
//! This module provides the infrastructure for attaching MCP servers to ACP
//! connections without tying the core SDK to a particular MCP implementation or
//! async runtime.
//!
//! ## Building MCP servers with tools
//!
//! The `agent-client-protocol-rmcp` crate provides the builder APIs for MCP
//! tools backed by the `rmcp` crate.
//!
//! ## Custom MCP Server Implementations
//!
//! You can implement [`McpServerConnect`](`crate::mcp_server::McpServerConnect`) to create custom MCP servers:
//!
//! ```rust,ignore
//! use agent_client_protocol::mcp_server::{McpConnectionTo, McpServer, McpServerConnect};
//! use agent_client_protocol::{DynConnectTo, NullRun, Role, role};
//!
//! struct MyCustomServer;
//!
//! impl<R: Role> McpServerConnect<R> for MyCustomServer {
//!     fn name(&self) -> String {
//!         "my-custom-server".to_string()
//!     }
//!
//!     fn connect(&self, cx: McpConnectionTo<R>) -> DynConnectTo<role::mcp::Client> {
//!         // Return a component that serves MCP requests
//!         DynConnectTo::new(my_mcp_component(cx))
//!     }
//! }
//!
//! let server = McpServer::new(MyCustomServer, NullRun);
//! ```

mod active_session;
mod connect;
mod context;
mod registry;
mod server;
mod tool;
mod tool_fn;

pub use connect::McpServerConnect;
pub use context::McpConnectionTo;
pub use registry::{
    EnabledTools, McpToolMetadata, McpToolRegistry, McpToolSchema, RegisteredMcpTool,
};
pub use server::McpServer;
pub use tool::McpTool;
pub use tool_fn::{tool_fn, tool_fn_mut};
