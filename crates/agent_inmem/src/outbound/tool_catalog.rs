//! Listing a session's MCP tools for its telemetry.
//!
//! The session actor records, on each turn's span, the tools the agent had to
//! choose from (`gen_ai.tool.definitions`). A sandboxed harness learns those
//! by dialing the MCP servers it was handed in `session/new`; this lists the
//! same servers the same way, in process through the egress proxy, so the
//! definitions on the span are the ones the agent saw - Macro's own tools and
//! the owner's connected apps alike, under the names the harness calls them
//! by. Which is also why Macro's server is *not* skipped here the way
//! [`dialable_servers`](crate::domain::mcp::dialable_servers) skips it for the
//! in-process runtime's own toolset: every other harness reaches Macro's tools
//! over that server, and the listing has to say so.

#[cfg(test)]
mod test;

use std::pin::Pin;
use std::sync::Arc;

use agent_client_protocol::schema::v1::McpServer;
use agent_session::domain::ports::{SessionToolCatalog, SessionToolDefinition};

use crate::domain::mcp::McpToolConnector;

/// A [`SessionToolCatalog`] over the connector the in-process runtime dials
/// its MCP servers with.
pub struct McpToolCatalog<Connector> {
    connector: Arc<Connector>,
}

impl<Connector> McpToolCatalog<Connector> {
    /// A catalog dialing through `connector`.
    pub fn new(connector: Arc<Connector>) -> Self {
        Self { connector }
    }
}

impl<Connector> SessionToolCatalog for McpToolCatalog<Connector>
where
    Connector: McpToolConnector,
{
    fn tool_definitions(
        &self,
        servers: Vec<McpServer>,
    ) -> Pin<Box<dyn Future<Output = Vec<SessionToolDefinition>> + Send + '_>> {
        Box::pin(async move {
            // HTTP entries only: the egress proxy serves nothing else, and a
            // stdio or SSE entry is not something this process can dial.
            let http = servers
                .into_iter()
                .filter_map(|server| match server {
                    McpServer::Http(http) => Some(http),
                    _ => None,
                })
                .collect();
            let Some(tools) = self.connector.connect(http).await else {
                return Vec::new();
            };
            tools
                .searchable_catalog()
                .into_iter()
                .map(|tool| SessionToolDefinition {
                    name: tool.name,
                    description: tool.description,
                    parameters: serde_json::to_value(tool.schema)
                        .unwrap_or(serde_json::Value::Null),
                })
                .collect()
        })
    }
}
