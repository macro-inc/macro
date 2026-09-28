//! The MCP servers an in-process session is handed, and how it reaches them.
//!
//! Every runtime the harness manages gets its MCP servers the same way: as
//! HTTP entries in `session/new` (and again on `session/resume`), each one an
//! egress-proxy URL carrying the session token. A sandboxed harness dials
//! those from its container; this runtime dials them from this process. The
//! traffic is the same, and so is what the proxy does with it: resolve the
//! app against the session owner's own connections, or answer a call to an
//! app they have not connected with a result the model can act on.

use agent_client_protocol::schema::v1::{McpServer as AcpMcpServer, McpServerHttp};
use mcp_toolset::RemoteMcpToolSet;

#[cfg(test)]
mod test;

/// The name the harness gives Macro's own MCP server in the ACP list.
///
/// Restated from `agent_harness::MACRO_MCP_NAME` rather than imported - this
/// crate is a runtime the harness drives, not a dependant of it - and pinned
/// equal by a test in the composition root, which sees both. Macro's tools are
/// native here (see [`ai_tools::all_tools`]), so the entry is skipped: dialing
/// it would give the model every Macro tool twice.
pub const MACRO_MCP_NAME: &str = "macro";

/// The servers this runtime should dial out of an ACP server list: HTTP
/// entries other than Macro's own. SSE and stdio entries are not something an
/// in-process runtime can serve and are dropped with a warning.
pub fn dialable_servers(servers: Vec<AcpMcpServer>) -> Vec<McpServerHttp> {
    servers
        .into_iter()
        .filter_map(|server| match server {
            AcpMcpServer::Http(http) if http.name == MACRO_MCP_NAME => None,
            AcpMcpServer::Http(http) => Some(http),
            other => {
                tracing::warn!(
                    server = ?other,
                    "an in-process session can only dial HTTP MCP servers; skipped"
                );
                None
            }
        })
        .collect()
}

/// Opens sessions on the HTTP MCP servers a session was handed and builds the
/// toolset over them.
///
/// A port because it is transport work: the production adapter speaks
/// streamable HTTP through the egress proxy, tests hand back nothing.
pub trait McpToolConnector: Send + Sync + 'static {
    /// Connect to every server, skipping any that fail, and return the tools
    /// found. `None` when no server yielded any tool.
    fn connect(
        &self,
        servers: Vec<McpServerHttp>,
    ) -> impl Future<Output = Option<RemoteMcpToolSet>> + Send;
}

/// Erased form of [`McpToolConnector`] for storage on the agent state.
pub trait DynMcpToolConnector: Send + Sync + 'static {
    /// See [`McpToolConnector::connect`].
    fn connect_dyn(
        &self,
        servers: Vec<McpServerHttp>,
    ) -> std::pin::Pin<Box<dyn Future<Output = Option<RemoteMcpToolSet>> + Send + '_>>;
}

impl<C: McpToolConnector> DynMcpToolConnector for C {
    fn connect_dyn(
        &self,
        servers: Vec<McpServerHttp>,
    ) -> std::pin::Pin<Box<dyn Future<Output = Option<RemoteMcpToolSet>> + Send + '_>> {
        Box::pin(self.connect(servers))
    }
}

/// A connector for deployments and tests that hand the runtime no servers.
pub struct NoMcpServers;

impl McpToolConnector for NoMcpServers {
    async fn connect(&self, _servers: Vec<McpServerHttp>) -> Option<RemoteMcpToolSet> {
        None
    }
}
