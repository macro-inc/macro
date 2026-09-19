//! Translate the standard ACP server list into the provider's remote server model.
use crate::domain::{
    mcp::{McpServer, McpServers, McpTransport},
    model::{Error, Result},
};
use agent_client_protocol::schema::v1::McpServer as AcpMcpServer;

pub(super) fn servers(params: &serde_json::Value) -> Result<McpServers> {
    let servers: Vec<AcpMcpServer> = serde_json::from_value(
        params
            .get("mcpServers")
            .cloned()
            .unwrap_or_else(|| serde_json::json!([])),
    )
    .map_err(|_| Error::McpConfiguration)?;
    let mut result = McpServers::new();
    for server in servers {
        let (name, transport, url, headers) = match server {
            AcpMcpServer::Http(server) => {
                (server.name, McpTransport::Http, server.url, server.headers)
            }
            AcpMcpServer::Sse(server) => {
                (server.name, McpTransport::Sse, server.url, server.headers)
            }
            _ => return Err(Error::McpConfiguration),
        };
        if name.is_empty() || result.contains_key(&name) {
            return Err(Error::McpConfiguration);
        }
        let mut mapped_headers = std::collections::BTreeMap::new();
        for header in headers {
            if mapped_headers.insert(header.name, header.value).is_some() {
                return Err(Error::McpConfiguration);
            }
        }
        result.insert(
            name,
            McpServer {
                transport,
                url,
                headers: mapped_headers,
            },
        );
    }
    Ok(result)
}
