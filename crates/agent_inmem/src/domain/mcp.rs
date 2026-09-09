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

/// Reserved name of the Macro MCP server supplied by the harness.
pub const MACRO_MCP_NAME: &str = "macro";

/// HTTP servers this runtime can dial, including Macro itself.
pub fn dialable_servers(servers: Vec<AcpMcpServer>) -> Vec<McpServerHttp> {
    servers
        .into_iter()
        .filter_map(|server| match server {
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

/// Connects the supplied servers. Production requires a working Macro catalog.
#[async_trait::async_trait]
pub trait McpToolConnector: Send + Sync + 'static {
    /// Optional integrations can fail independently of the required Macro server.
    async fn connect(
        &self,
        servers: Vec<McpServerHttp>,
        input: Option<super::user_input::SharedUserInputRequester>,
    ) -> Result<Option<RemoteMcpToolSet>, String>;
}

/// Connector for scripted engines that do not execute product tools.
pub struct NoMcpServers;

#[async_trait::async_trait]
impl McpToolConnector for NoMcpServers {
    async fn connect(
        &self,
        _servers: Vec<McpServerHttp>,
        _input: Option<super::user_input::SharedUserInputRequester>,
    ) -> Result<Option<RemoteMcpToolSet>, String> {
        Ok(None)
    }
}
