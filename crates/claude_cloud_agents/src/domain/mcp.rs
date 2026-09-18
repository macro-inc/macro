//! Remote MCP configuration carried by an agent's session handshake.
use serde::Serialize;
use std::collections::BTreeMap;

/// Remote transports supported by the cloud worker.
#[derive(Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum McpTransport {
    /// Streamable HTTP.
    Http,
    /// HTTP with server-sent events.
    Sse,
}

/// One server. Deliberately not Debug: headers contain session credentials.
#[derive(Clone, Serialize)]
pub struct McpServer {
    /// Remote transport kind.
    #[serde(rename = "type")]
    pub transport: McpTransport,
    /// The URL supplied by the session's egress provisioner.
    pub url: String,
    /// Session-scoped authorization and other supplied headers.
    pub headers: BTreeMap<String, String>,
}

/// Servers keyed by their stable ACP names.
pub type McpServers = BTreeMap<String, McpServer>;
