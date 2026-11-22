//! The agent tools for connectors: discovering apps the user could connect
//! (`DiscoverConnectors`), and adding a server by URL (`ConnectMcpServer`).
//!
//! Both answer through the services, so "connected" means what it means to
//! chat and agents: the status the connection rules decide.

use crate::domain::discovery::{AppDetails, CatalogApp, ConnectorCatalogService};
use crate::domain::models::{AddedBy, Connector, ConnectorId, ConnectorsError, ServerUrl, Status};
use crate::domain::service::ConnectionManagementService;
use crate::inbound::dto::ConnectorStatus;
use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations,
    ToolCallError, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[cfg(test)]
mod test;

/// How many apps a discovery search lists.
const SEARCH_PAGE_SIZE: u32 = 10;

/// What the connector tools run on.
///
/// The services are optional because the tool schemas ship with the shared
/// chat toolset while only some hosts build the services. Where they are
/// absent, calls fail with a clear error.
pub struct ConnectorToolContext<S, C> {
    connectors: Option<Arc<S>>,
    catalog: Option<Arc<C>>,
}

impl<S, C> Clone for ConnectorToolContext<S, C> {
    fn clone(&self) -> Self {
        Self {
            connectors: self.connectors.clone(),
            catalog: self.catalog.clone(),
        }
    }
}

impl<S, C> ConnectorToolContext<S, C> {
    /// Tools over the connection services and the catalog.
    pub fn wired(connectors: S, catalog: C) -> Self {
        Self {
            connectors: Some(Arc::new(connectors)),
            catalog: Some(Arc::new(catalog)),
        }
    }

    /// No services: every call fails with a clear error.
    pub fn unwired() -> Self {
        Self {
            connectors: None,
            catalog: None,
        }
    }

    fn connectors(&self) -> Result<&S, ToolCallError> {
        self.connectors.as_deref().ok_or_else(|| ToolCallError {
            description: "Connecting MCP servers is not available here.".to_owned(),
            internal_error: anyhow::anyhow!("connection services not wired into this host"),
        })
    }

    fn catalog(&self) -> Result<&C, ToolCallError> {
        self.catalog.as_deref().ok_or_else(|| ToolCallError {
            description: "Connector discovery is not configured on this deployment".to_owned(),
            internal_error: anyhow::anyhow!("connector catalog not wired into this host"),
        })
    }
}

/// Both connector tools.
pub fn connector_toolset<S, C>() -> AsyncToolCollection<ConnectorToolContext<S, C>>
where
    S: ConnectionManagementService,
    C: ConnectorCatalogService,
{
    AsyncToolCollection::new()
        .add_tool::<DiscoverConnectors, ConnectorToolContext<S, C>>()
        .add_tool::<ConnectMcpServer, ConnectorToolContext<S, C>>()
}

/// A service failure as a tool error: refusals the agent can act on keep
/// their message; anything else is a plain failure.
fn tool_error(error: ConnectorsError, failure: &str) -> ToolCallError {
    let description = match &error {
        ConnectorsError::Internal(_) => failure.to_owned(),
        refusal => refusal.to_string(),
    };

    ToolCallError {
        description,
        internal_error: anyhow::anyhow!("{error:?}"),
    }
}

// -- DiscoverConnectors ------------------------------------------------------

/// Search by app name, then inspect a returned slug before recommending auth.
#[derive(Debug, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum DiscoveryRequest {
    /// Find connectable apps by name.
    Search {
        /// App name, e.g. "Notion" or "Linear", not a task description.
        query: String,
    },
    /// Verify capabilities and connection status for one catalog app.
    Inspect {
        /// Exact app slug from search results.
        app_slug: String,
    },
}

/// An advertised action, not a tool loaded into the current turn.
#[derive(Debug, Serialize, JsonSchema, utoipa::ToSchema)]
pub struct ConnectorTool {
    /// Upstream tool name.
    pub name: String,
    /// What the action supports.
    pub description: String,
}

/// A verified app identity from the directory.
#[derive(Debug, Serialize, JsonSchema, utoipa::ToSchema)]
pub struct DiscoveredApp {
    /// Exact identity to inspect or connect.
    pub app_slug: String,
    /// Human-readable app name.
    pub name: String,
    /// Directory description; inspect tools to verify specific capabilities.
    pub description: Option<String>,
}

impl From<CatalogApp> for DiscoveredApp {
    fn from(app: CatalogApp) -> Self {
        Self {
            app_slug: app.id.as_str().to_owned(),
            name: app.name,
            description: app.description,
        }
    }
}

/// Discovery results never execute tools or change connections.
#[derive(Debug, Serialize, JsonSchema, utoipa::ToSchema)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum DiscoveryResult {
    /// Candidate apps; none has had its capabilities verified yet.
    Search {
        /// Matching apps.
        apps: Vec<DiscoveredApp>,
        /// Narrow the app name if this is true.
        more_results: bool,
    },
    /// Verified identity, capabilities and this caller's connection status.
    Inspect {
        /// App from the directory.
        app: DiscoveredApp,
        /// Whether this caller's connection to the app is usable now.
        connected: bool,
        /// Advertised tools. Use SearchTools after connecting to load them.
        tools: Vec<ConnectorTool>,
        /// True when some advertised tools were omitted.
        tools_truncated: bool,
    },
}

impl From<AppDetails> for DiscoveryResult {
    fn from(details: AppDetails) -> Self {
        Self::Inspect {
            app: details.app.into(),
            connected: details.status == Status::Connected,
            tools: details
                .tools
                .into_iter()
                .map(|tool| ConnectorTool {
                    name: tool.name,
                    description: tool.description,
                })
                .collect(),
            tools_truncated: details.tools_truncated,
        }
    }
}

/// Discover apps when the current tools cannot perform the user's task.
#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(
    title = "DiscoverConnectors",
    description = "Find an integration when an external app is missing or a workflow requires an unconnected account, including native import tools that need a connector. Use SearchTools for available actions. Search by app name, then inspect a returned app_slug to see its actual tools and connection status. Only recommend connecting if an advertised tool supports the task; an app's name alone is not evidence. Inspection does not load or execute tools. If suitable and unconnected, include the returned connect_markup in your reply and explain what connecting enables. After connection, use SearchTools again in the same agent session to load and call the new tools."
)]
pub struct DiscoverConnectors {
    /// Search for an app, or inspect a catalog result's actual capabilities.
    pub request: DiscoveryRequest,
}

/// Discovery metadata and optional markup for a user-controlled auth flow.
#[derive(Debug, Serialize, JsonSchema, utoipa::ToSchema)]
pub struct DiscoverConnectorsResponse {
    /// Catalog or capability results.
    pub result: DiscoveryResult,
    /// Include verbatim only if an advertised tool supports the requested task.
    pub connect_markup: Option<String>,
}

impl From<DiscoveryResult> for DiscoverConnectorsResponse {
    /// Offer connect markup only for an unconnected app whose inspected tools
    /// could do something.
    fn from(result: DiscoveryResult) -> Self {
        let connect_markup = match &result {
            DiscoveryResult::Inspect {
                app,
                connected: false,
                tools,
                ..
            } if !tools.is_empty() => {
                let payload = serde_json::json!({"appSlug": app.app_slug, "name": app.name});
                Some(format!("<m-connect-app>{payload}</m-connect-app>"))
            }
            _ => None,
        };

        Self {
            result,
            connect_markup,
        }
    }
}

impl ToolAnnotated for DiscoverConnectors {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Discover connectors");
}

/// An inspection of a slug the catalog does not have.
fn unknown_app() -> ToolCallError {
    ToolCallError {
        description: "No connectable app has that slug; search the catalog first".to_owned(),
        internal_error: anyhow::anyhow!("DiscoverConnectors inspected an unknown app"),
    }
}

#[async_trait]
impl<S, C> AsyncTool<ConnectorToolContext<S, C>> for DiscoverConnectors
where
    S: ConnectionManagementService,
    C: ConnectorCatalogService,
{
    type Output = DiscoverConnectorsResponse;

    async fn call(
        &self,
        context: ServiceContext<ConnectorToolContext<S, C>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let catalog = context.catalog()?;
        let user = &request.user_id;
        let result = match &self.request {
            DiscoveryRequest::Search { query } => {
                if query.trim().is_empty() {
                    return Err(ToolCallError {
                        description: "Search for an app name, such as Linear".to_owned(),
                        internal_error: anyhow::anyhow!("DiscoverConnectors searched for nothing"),
                    });
                }
                let page = catalog
                    .search(user, Some(query), None, Some(SEARCH_PAGE_SIZE))
                    .await
                    .map_err(|error| tool_error(error, "Could not search the catalog."))?;
                DiscoveryResult::Search {
                    apps: page.apps.into_iter().map(DiscoveredApp::from).collect(),
                    more_results: page.next_cursor.is_some(),
                }
            }
            DiscoveryRequest::Inspect { app_slug } => {
                let app = ConnectorId::parse(app_slug).map_err(|_| unknown_app())?;
                catalog
                    .inspect(user, &app)
                    .await
                    .map_err(|error| tool_error(error, "Could not inspect the app."))?
                    .ok_or_else(unknown_app)?
                    .into()
            }
        };

        Ok(DiscoverConnectorsResponse::from(result))
    }
}

// -- ConnectMcpServer --------------------------------------------------------

/// Add a custom MCP server to the user's connections.
#[derive(Debug, Clone, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ConnectMcpServer",
    description = "Add a remote MCP server to the current user's connections by its URL, so their agents and chats can use its tools. Use when the user asks to connect, add, or install an MCP server they give you the URL of, or one whose official remote MCP URL you are sure of; never guess a URL. Most servers need the user to sign in afterwards: when the result says so, tell them to open Settings → Connections and click Connect next to the server. Its tools are available in new conversations once connected. A URL the user already has is left as it is."
)]
pub struct ConnectMcpServer {
    /// The server's URL.
    #[schemars(
        description = "The MCP server's streamable HTTP URL, e.g. `https://mcp.linear.app/mcp`. Must be https on a public host."
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
#[derive(Debug, Serialize, JsonSchema, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectMcpServerResponse {
    /// The server's URL, normalized.
    pub url: String,
    /// The connector's display name.
    pub server_name: String,
    /// Where the user stands with it.
    pub status: ConnectorStatus,
    /// Whether its tools are turned on.
    pub enabled: bool,
    /// What happened and what the user still has to do.
    pub summary: String,
}

impl ConnectMcpServerResponse {
    fn new(url: &ServerUrl, connector: &Connector) -> Self {
        let name = connector.name();
        let summary = match connector.status() {
            Status::Connected => format!(
                "{name} is in the user's connections, and its tools are available in new conversations. If it needs a sign-in, the user must open Settings → Connections and click Connect next to {name}."
            ),
            Status::Disabled => format!(
                "{name} is in the user's connections but turned off. The user can enable it in Settings → Connections."
            ),
            Status::NeedsReauth | Status::NotConnected => format!(
                "{name} is added but not signed in. The user must open Settings → Connections and click Connect next to {name}."
            ),
        };

        Self {
            url: url.as_str().to_owned(),
            server_name: name.to_owned(),
            status: connector.status().into(),
            enabled: connector.status() != Status::Disabled,
            summary,
        }
    }
}

#[async_trait]
impl<S, C> AsyncTool<ConnectorToolContext<S, C>> for ConnectMcpServer
where
    S: ConnectionManagementService,
    C: ConnectorCatalogService,
{
    type Output = ConnectMcpServerResponse;

    async fn call(
        &self,
        context: ServiceContext<ConnectorToolContext<S, C>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let connectors = context.connectors()?;
        let url = ServerUrl::parse(&self.url).map_err(|error| ToolCallError {
            description: error.to_string(),
            internal_error: anyhow::anyhow!("invalid ConnectMcpServer arguments: {error}"),
        })?;
        let connector = connectors
            .add_server(
                &request.user_id,
                url.clone(),
                &self.server_name,
                AddedBy::Agent,
            )
            .await
            .map_err(|error| tool_error(error, "Could not save the MCP server."))?;

        Ok(ConnectMcpServerResponse::new(&url, &connector))
    }
}
