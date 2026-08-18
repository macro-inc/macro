#![deny(missing_docs)]
//! Selection between the two MCP connector stacks.
//!
//! The native stack (`mcp_client`: in-house OAuth, servers connected
//! by URL) and the Pipedream stack (`pipedream_mcp`: apps connected through
//! Pipedream Connect) are deliberately separate — separate endpoints,
//! tables, and toolsets. The one place they must meet is deciding which
//! tools a user's agent actually gets. This crate owns that rule:
//!
//! 1. Load both stacks' connectors.
//! 2. If the user has any Pipedream connectors, use only those.
//! 3. Otherwise, use the native connectors.

use ai_toolset::{
    AsyncToolCollection, RequestContext, RequestSchema, SearchableTool, ToolInfo, ToolResult,
    ToolSet, ToolSetError,
};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_client::domain::ports::McpServerStore;
use mcp_client::domain::service::McpToolSet;
use pipedream_mcp::domain::ports::{ConnectionStore, McpConnection};
use pipedream_mcp::domain::service::PipedreamToolSet;
use std::pin::Pin;
use std::sync::Arc;

/// Mangled MCP tool names start with this prefix on both stacks.
const MANGLED_PREFIX: &str = "mcp__";

/// A connector identified in both stacks: the Pipedream app slug and the
/// native server URL that back the same product (e.g. `linear` /
/// `https://mcp.linear.app/mcp`).
#[derive(Clone, Copy, Debug)]
pub struct ConnectorRef<'a> {
    /// Pipedream app name slug, e.g. `linear`.
    pub pipedream_app_slug: &'a str,
    /// The native stack's MCP server URL for the same product.
    pub native_server_url: &'a str,
}

/// The MCP tools loaded for a user — from exactly one stack, per the
/// selection rule above.
pub enum UserMcpTools {
    /// Tools served by Pipedream's remote MCP server.
    Pipedream(PipedreamToolSet),
    /// Tools served by directly-connected (native) MCP servers.
    Native(McpToolSet),
}

impl UserMcpTools {
    /// Returns `true` when no tools were discovered.
    pub fn is_empty(&self) -> bool {
        match self {
            UserMcpTools::Pipedream(tools) => tools.is_empty(),
            UserMcpTools::Native(tools) => tools.is_empty(),
        }
    }

    /// The full catalog of MCP tools for on-demand loading via tool search.
    pub fn catalog(&self) -> Vec<SearchableTool> {
        match self {
            UserMcpTools::Pipedream(tools) => tools.searchable_catalog(),
            UserMcpTools::Native(tools) => tools.searchable_catalog(),
        }
    }
}

impl<Context: Send + Sync + 'static> ToolSet<Context> for UserMcpTools {
    fn try_tool_call<'a>(
        &'a self,
        context: Context,
        request_context: RequestContext,
        tool_name: &'a str,
        json: &'a serde_json::Value,
    ) -> Pin<
        Box<dyn Future<Output = Result<ToolResult<serde_json::Value>, ToolSetError>> + 'a + Send>,
    > {
        match self {
            UserMcpTools::Pipedream(tools) => {
                tools.try_tool_call(context, request_context, tool_name, json)
            }
            UserMcpTools::Native(tools) => {
                tools.try_tool_call(context, request_context, tool_name, json)
            }
        }
    }

    fn request_schemas(&self) -> Option<Vec<RequestSchema>> {
        match self {
            UserMcpTools::Pipedream(tools) => ToolSet::<Context>::request_schemas(tools),
            UserMcpTools::Native(tools) => ToolSet::<Context>::request_schemas(tools),
        }
    }

    fn searchable_toolset_names(&self) -> Vec<String> {
        match self {
            UserMcpTools::Pipedream(tools) => ToolSet::<Context>::searchable_toolset_names(tools),
            UserMcpTools::Native(tools) => ToolSet::<Context>::searchable_toolset_names(tools),
        }
    }

    fn routing_description<'a>(&'a self, tool_name: &'a str) -> Option<ToolInfo> {
        match self {
            UserMcpTools::Pipedream(tools) => {
                ToolSet::<Context>::routing_description(tools, tool_name)
            }
            UserMcpTools::Native(tools) => {
                ToolSet::<Context>::routing_description(tools, tool_name)
            }
        }
    }
}

/// Port for consumers (imports, onboarding) that need per-connector tools
/// or connection state without knowing which stack serves them.
pub trait ConnectorSelect: Send + Sync + 'static {
    /// Load the user's full MCP toolset (all connectors, one stack).
    fn user_toolset(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = UserMcpTools> + Send;

    /// Load the toolset for one connector. `Ok(None)` when the user has it
    /// connected on neither stack.
    fn connector_toolset(
        &self,
        user: &MacroUserIdStr<'static>,
        connector: ConnectorRef<'_>,
    ) -> impl Future<Output = anyhow::Result<Option<UserMcpTools>>> + Send;

    /// Whether the user has this connector, on whichever stack the
    /// selection rule picks for them.
    fn connector_connected(
        &self,
        user: &MacroUserIdStr<'static>,
        connector: ConnectorRef<'_>,
    ) -> impl Future<Output = anyhow::Result<bool>> + Send;
}

/// The concrete selector: loads both stacks' stores and applies the rule.
pub struct McpToolSelector<N, P, C> {
    native_store: Arc<N>,
    pipedream_store: Arc<P>,
    pipedream_connection: Arc<C>,
}

impl<N, P, C> Clone for McpToolSelector<N, P, C> {
    fn clone(&self) -> Self {
        Self {
            native_store: self.native_store.clone(),
            pipedream_store: self.pipedream_store.clone(),
            pipedream_connection: self.pipedream_connection.clone(),
        }
    }
}

impl<N, P, C> McpToolSelector<N, P, C>
where
    N: McpServerStore,
    P: ConnectionStore,
    C: McpConnection,
{
    /// Build a selector over the native store and the Pipedream store +
    /// remote MCP connection.
    pub fn new(
        native_store: Arc<N>,
        pipedream_store: Arc<P>,
        pipedream_connection: Arc<C>,
    ) -> Self {
        Self {
            native_store,
            pipedream_store,
            pipedream_connection,
        }
    }

    /// The user's Pipedream connections, or empty when the store errs
    /// (an error must degrade to the native stack, not kill the request).
    async fn pipedream_connections(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Vec<pipedream_mcp::domain::models::PipedreamConnection> {
        self.pipedream_store
            .list(user)
            .await
            .inspect_err(|e| tracing::warn!(error = ?e, "failed to list Pipedream connections"))
            .unwrap_or_default()
    }
}

impl<N, P, C> ConnectorSelect for McpToolSelector<N, P, C>
where
    N: McpServerStore,
    P: ConnectionStore,
    C: McpConnection,
{
    #[tracing::instrument(skip_all)]
    async fn user_toolset(&self, user: &MacroUserIdStr<'static>) -> UserMcpTools {
        let pipedream = self.pipedream_connections(user).await;
        if !pipedream.is_empty() {
            return UserMcpTools::Pipedream(
                PipedreamToolSet::new(&pipedream, self.pipedream_connection.clone()).await,
            );
        }

        let native = self
            .native_store
            .list(user)
            .await
            .inspect_err(|e| tracing::warn!(error = ?e, "failed to list native MCP servers"))
            .unwrap_or_default();
        UserMcpTools::Native(McpToolSet::new(&native, self.native_store.clone()).await)
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn connector_toolset(
        &self,
        user: &MacroUserIdStr<'static>,
        connector: ConnectorRef<'_>,
    ) -> anyhow::Result<Option<UserMcpTools>> {
        let pipedream = self.pipedream_connections(user).await;
        if !pipedream.is_empty() {
            // The user is on the Pipedream stack: native connectors are
            // ignored even if this particular app isn't connected there.
            let matching: Vec<_> = pipedream
                .into_iter()
                .filter(|c| c.app_slug == connector.pipedream_app_slug)
                .collect();
            if matching.is_empty() {
                return Ok(None);
            }
            return Ok(Some(UserMcpTools::Pipedream(
                PipedreamToolSet::new(&matching, self.pipedream_connection.clone()).await,
            )));
        }

        let matching: Vec<_> = self
            .native_store
            .list(user)
            .await
            .map_err(|e| anyhow::anyhow!("mcp store: {e:?}"))?
            .into_iter()
            .filter(|r| r.url == connector.native_server_url)
            .collect();
        if matching.is_empty() {
            return Ok(None);
        }
        Ok(Some(UserMcpTools::Native(
            McpToolSet::new(&matching, self.native_store.clone()).await,
        )))
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn connector_connected(
        &self,
        user: &MacroUserIdStr<'static>,
        connector: ConnectorRef<'_>,
    ) -> anyhow::Result<bool> {
        let pipedream = self.pipedream_connections(user).await;
        if !pipedream.is_empty() {
            return Ok(pipedream
                .iter()
                .any(|c| c.app_slug == connector.pipedream_app_slug));
        }

        let native = self
            .native_store
            .list(user)
            .await
            .map_err(|e| anyhow::anyhow!("mcp store: {e:?}"))?;
        Ok(native
            .iter()
            .any(|r| r.credentials.is_some() && r.url == connector.native_server_url))
    }
}

/// Wraps a static [`AsyncToolCollection`] and the user's selected MCP tools,
/// presenting them as a single toolset to the AI loop.
pub struct CombinedToolSet<T> {
    static_tools: Arc<AsyncToolCollection<T>>,
    mcp_tools: UserMcpTools,
}

impl<T> CombinedToolSet<T> {
    /// Combine the static tools with an already-selected MCP toolset.
    pub fn new(static_tools: Arc<AsyncToolCollection<T>>, mcp_tools: UserMcpTools) -> Self {
        Self {
            static_tools,
            mcp_tools,
        }
    }
}

impl<T: Send + Sync + 'static> ToolSet<T> for CombinedToolSet<T> {
    fn try_tool_call<'a>(
        &'a self,
        context: T,
        request_context: RequestContext,
        tool_name: &'a str,
        json: &'a serde_json::Value,
    ) -> Pin<
        Box<dyn Future<Output = Result<ToolResult<serde_json::Value>, ToolSetError>> + 'a + Send>,
    > {
        if tool_name.starts_with(MANGLED_PREFIX) {
            self.mcp_tools
                .try_tool_call(context, request_context, tool_name, json)
        } else {
            self.static_tools
                .try_tool_call(context, request_context, tool_name, json)
        }
    }

    fn request_schemas(&self) -> Option<Vec<RequestSchema>> {
        // Only the static (first-party) tools are sent on every request. MCP
        // tools are loaded on demand via the `SearchTools` tool — they are
        // surfaced through `searchable_catalog`, not here — so a large or
        // growing MCP catalog never bloats the request.
        self.static_tools.request_schemas()
    }

    fn searchable_catalog(&self) -> Vec<SearchableTool> {
        self.mcp_tools.catalog()
    }

    fn searchable_toolset_names(&self) -> Vec<String> {
        ToolSet::<T>::searchable_toolset_names(&self.mcp_tools)
    }

    fn routing_description<'a>(&'a self, tool_name: &'a str) -> Option<ToolInfo> {
        if tool_name.starts_with(MANGLED_PREFIX) {
            ToolSet::<T>::routing_description(&self.mcp_tools, tool_name)
        } else {
            self.static_tools.routing_description(tool_name)
        }
    }
}
