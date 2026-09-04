//! Dialing the HTTP MCP servers a session was handed over ACP.

use std::collections::HashMap;

use agent_client_protocol::schema::v1::McpServerHttp;
use http::header::{AUTHORIZATION, HeaderName, HeaderValue};
use mcp_toolset::{ConnectedServer, RemoteMcpToolSet, client_info};
use rmcp::ServiceExt as _;
use rmcp::transport::StreamableHttpClientTransport;
use rmcp::transport::streamable_http_client::{
    StreamableHttpClient, StreamableHttpClientTransportConfig,
};

use crate::domain::mcp::McpToolConnector;

#[cfg(test)]
mod test;

/// Where one advertised header goes on the rmcp transport.
#[derive(Debug, PartialEq, Eq)]
enum HeaderPlacement {
    /// `Authorization: Bearer <token>`: rmcp takes the bare token and adds the
    /// scheme itself, so the scheme must come off here or the proxy sees
    /// `Bearer Bearer <token>` and knows no such session.
    BearerToken(String),
    /// Anything else, sent verbatim.
    Custom(HeaderName, HeaderValue),
}

/// Decide how an ACP `HttpHeader` reaches the wire. `None` when the name or
/// value is not a valid header.
fn place_header(name: &str, value: &str) -> Option<HeaderPlacement> {
    let header_name = HeaderName::from_bytes(name.as_bytes()).ok()?;
    if header_name == AUTHORIZATION {
        let mut parts = value.splitn(2, ' ');
        if let (Some(scheme), Some(token)) = (parts.next(), parts.next())
            && scheme.eq_ignore_ascii_case("bearer")
        {
            return Some(HeaderPlacement::BearerToken(token.trim().to_owned()));
        }
    }
    let header_value = HeaderValue::from_str(value).ok()?;
    Some(HeaderPlacement::Custom(header_name, header_value))
}

/// [`McpToolConnector`] over rmcp's streamable-HTTP client.
///
/// Each entry is dialed exactly as handed over: its URL is the egress proxy
/// and its `Authorization` header is the session token, so this process holds
/// no upstream credential any more than a sandbox does. What carries the
/// request is the `Client` - in production
/// [`EgressMcpClient`](super::egress_mcp::EgressMcpClient), which hands it
/// to the proxy's service without a socket.
#[derive(Clone)]
pub struct AcpMcpConnector<Client> {
    client: Client,
}

impl<Client> AcpMcpConnector<Client>
where
    Client: StreamableHttpClient + Send + Sync,
{
    /// A connector sharing one client across every server it dials.
    pub fn new(client: Client) -> Self {
        Self { client }
    }

    async fn connect_one(&self, server: McpServerHttp) -> Option<ConnectedServer> {
        let mut config = StreamableHttpClientTransportConfig::with_uri(server.url.clone());
        let mut custom = HashMap::new();
        for header in &server.headers {
            match place_header(&header.name, &header.value) {
                Some(HeaderPlacement::BearerToken(token)) => {
                    config = config.auth_header(token);
                }
                Some(HeaderPlacement::Custom(name, value)) => {
                    custom.insert(name, value);
                }
                None => {
                    tracing::warn!(server = %server.name, header = %header.name, "dropping an invalid header");
                }
            }
        }
        config.custom_headers = custom;

        let transport = StreamableHttpClientTransport::with_client(self.client.clone(), config);
        match client_info().serve(transport).await {
            Ok(client) => Some(ConnectedServer {
                name: server.name,
                client,
            }),
            Err(error) => {
                // One server that will not answer must not cost the session
                // the others, nor the session itself.
                tracing::warn!(server = %server.name, error = ?error, "failed to connect to an MCP server; skipping it");
                None
            }
        }
    }
}

impl<Client> McpToolConnector for AcpMcpConnector<Client>
where
    Client: StreamableHttpClient + Send + Sync,
{
    #[tracing::instrument(skip_all, fields(servers = servers.len()))]
    async fn connect(&self, servers: Vec<McpServerHttp>) -> Option<RemoteMcpToolSet> {
        if servers.is_empty() {
            return None;
        }
        let connected: Vec<ConnectedServer> =
            futures::future::join_all(servers.into_iter().map(|server| self.connect_one(server)))
                .await
                .into_iter()
                .flatten()
                .collect();
        if connected.is_empty() {
            return None;
        }
        let tools = RemoteMcpToolSet::from_connected(connected, None).await;
        if tools.is_empty() {
            return None;
        }
        Some(tools)
    }
}
