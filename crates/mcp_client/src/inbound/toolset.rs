//! AI tools over the user's custom MCP servers.

use crate::domain::ports::McpServerStore;
use crate::domain::service::{AddServerError, AddedServer, ServerDirectory};
use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations,
    ToolCallError, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod test;

/// Service context for the custom MCP server tools.
///
/// The directory is optional because the tool schemas ship with the shared
/// chat toolset while only hosts holding the MCP credentials key can build
/// the store. Where it is absent, calls fail with a clear error.
pub struct McpServerToolContext<Store> {
    /// The user's custom MCP servers, where the host wired them.
    pub servers: Option<ServerDirectory<Store>>,
}

impl<Store> Clone for McpServerToolContext<Store> {
    fn clone(&self) -> Self {
        Self {
            servers: self.servers.clone(),
        }
    }
}

impl<Store> McpServerToolContext<Store> {
    /// A context whose tools add servers to `servers`.
    pub fn wired(servers: ServerDirectory<Store>) -> Self {
        Self {
            servers: Some(servers),
        }
    }

    /// A context with no server store: every tool call fails with a clear
    /// error.
    pub fn unwired() -> Self {
        Self { servers: None }
    }
}

/// The custom MCP server toolset.
pub fn mcp_server_toolset<Store>() -> AsyncToolCollection<McpServerToolContext<Store>>
where
    Store: McpServerStore,
    anyhow::Error: From<Store::Err>,
{
    AsyncToolCollection::new().add_tool::<ConnectMcpServer, McpServerToolContext<Store>>()
}

/// Add a custom MCP server to the user's connections.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ConnectMcpServer",
    description = "Add a remote MCP server to the current user's connections by its URL, so their agents and chats can use its tools. Use when the user asks to connect, add, or install an MCP server they give you the URL of, or one whose official remote MCP URL you are sure of; never guess a URL. Most servers need the user to sign in afterwards: when the result says so, tell them to open Settings → Connections and click Connect next to the server. Its tools are available in new conversations once connected. A URL the user already has is left as it is."
)]
pub struct ConnectMcpServer {
    /// The server's URL.
    #[schemars(
        description = "The MCP server's streamable HTTP URL, e.g. `https://mcp.linear.app/mcp`."
    )]
    pub url: String,
    /// Display name for the server.
    #[schemars(
        description = "Short display name for the server, e.g. `Linear`. Its tools are listed under this name."
    )]
    pub server_name: String,
}

impl ToolAnnotated for ConnectMcpServer {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Connect MCP server");
}

/// Response from [`ConnectMcpServer`].
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectMcpServerResponse {
    /// The server's URL.
    pub url: String,
    /// The server's display name.
    pub server_name: String,
    /// Whether the user already had this server before the call.
    pub already_connected: bool,
    /// Whether the server holds the user's sign-in.
    pub authenticated: bool,
    /// Whether the server's tools are turned on.
    pub enabled: bool,
    /// What happened and what the user still has to do.
    pub summary: String,
}

#[async_trait]
impl<Store> AsyncTool<McpServerToolContext<Store>> for ConnectMcpServer
where
    Store: McpServerStore,
    anyhow::Error: From<Store::Err>,
{
    type Output = ConnectMcpServerResponse;

    #[tracing::instrument(skip_all, fields(user_id = %request_context.user_id, url = %self.url), err)]
    async fn call(
        &self,
        service_context: ServiceContext<McpServerToolContext<Store>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let servers = service_context
            .servers
            .as_ref()
            .ok_or_else(|| ToolCallError {
                description: "Connecting MCP servers is not available here.".to_owned(),
                internal_error: anyhow::anyhow!("MCP server store not wired into this host"),
            })?;
        let added = servers
            .add(request_context.user_id, &self.url, &self.server_name)
            .await
            .map_err(|error| match error {
                AddServerError::InvalidUrl(_) | AddServerError::EmptyName => ToolCallError {
                    description: error.to_string(),
                    internal_error: anyhow::anyhow!("invalid ConnectMcpServer arguments: {error}"),
                },
                AddServerError::Store(error) => ToolCallError {
                    description: "Could not save the MCP server.".to_owned(),
                    internal_error: error,
                },
            })?;
        Ok(ConnectMcpServerResponse::from(added))
    }
}

impl From<AddedServer> for ConnectMcpServerResponse {
    fn from(added: AddedServer) -> Self {
        let already_connected = matches!(added, AddedServer::Existing(_));
        let record = match added {
            AddedServer::New(record) | AddedServer::Existing(record) => record,
        };
        let authenticated = record.credentials.is_some();
        let name = &record.server_name;
        let summary = match (already_connected, authenticated, record.enabled) {
            (false, _, _) => format!(
                "Added {name}. If it needs a sign-in, the user must open Settings → Connections and click Connect next to {name}."
            ),
            (true, false, _) => format!(
                "{name} was already added but is not signed in. The user must open Settings → Connections and click Connect next to {name}."
            ),
            (true, true, false) => format!(
                "{name} is already connected but turned off. The user can enable it in Settings → Connections."
            ),
            (true, true, true) => format!("{name} is already connected."),
        };
        Self {
            url: record.url,
            server_name: record.server_name,
            already_connected,
            authenticated,
            enabled: record.enabled,
            summary,
        }
    }
}
