#![deny(missing_docs)]
//! An [`ai_toolset::ToolSet`] over already-connected MCP servers.
//!
//! Every MCP-backed toolset in Macro needs the same three things once it has
//! live sessions in hand: list each server's tools, expose them under
//! provider-safe mangled names (`mcp__<server>__<tool>`), and route a call by
//! that name back to the right peer with the tool's real name. This crate is
//! that shared piece, and nothing else - it does not know how a session was
//! opened. `pipedream_mcp` connects through Pipedream's remote server and the
//! in-process agent runtime dials the servers it was handed over ACP; both
//! end here.

mod call_tool_result;
mod mangle;
mod toolset;

pub use call_tool_result::CallToolResultExt;
pub use toolset::{ConnectedServer, Error, RemoteMcpToolSet};

use rmcp::RoleClient;
use rmcp::model::{ClientInfo, Implementation};
use rmcp::service::RunningService;

/// Our MCP client publishes this name to servers on-connect.
pub const MCP_CLIENT_NAME: &str = "Macro";

/// A connected MCP server session.
pub type McpServer = RunningService<RoleClient, ClientInfo>;

/// Build the client info sent to MCP servers during initialization.
pub fn client_info() -> ClientInfo {
    ClientInfo::new(
        Default::default(),
        Implementation::new(MCP_CLIENT_NAME, env!("CARGO_PKG_VERSION")),
    )
}
