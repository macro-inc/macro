#![deny(missing_docs)]
//! Per-provider selection and composition of native and Pipedream MCP tools.
//!
//! Enabled native connections take precedence for known providers. Other
//! enabled Pipedream apps remain available, with one connection per provider.

use ai_toolset::{
    AsyncToolCollection, RequestContext, RequestSchema, SearchableTool, ToolInfo, ToolResult,
    ToolSet, ToolSetError,
};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_client::domain::ports::McpServerStore;
use mcp_client::domain::service::McpToolSet;
use pipedream_mcp::domain::ports::{ConnectionStore, McpConnection};
use pipedream_mcp::domain::service::PipedreamToolSet;
use std::collections::HashSet;
use std::pin::Pin;

mod selection;
use selection::native_matches;
pub use selection::select_connections;
use std::sync::Arc;

#[cfg(test)]
mod test;

/// Mangled MCP tool names start with this prefix on both stacks.
pub const MANGLED_PREFIX: &str = "mcp__";

/// A connector identified in both stacks: the Pipedream app slugs and the
/// native server URL that back the same product (e.g. `linear` /
/// `https://mcp.linear.app/mcp`).
#[derive(Clone, Copy, Debug)]
pub struct ConnectorRef<'a> {
    /// Pipedream app name slugs in preference order, e.g. `slack`, `slack_v2`.
    pub pipedream_app_slugs: &'a [&'a str],
    /// The native stack's MCP server URL for the same product.
    pub native_server_url: &'a str,
}

impl ConnectorRef<'_> {
    /// Whether this connector recognizes the Pipedream app slug.
    pub fn matches_pipedream_slug(&self, slug: &str) -> bool {
        self.pipedream_app_slugs.contains(&slug)
    }
}

/// The MCP tools loaded for a user, composed across both connection stacks.
pub enum UserMcpTools {
    /// Tools served by Pipedream's remote MCP server.
    Pipedream(PipedreamToolSet),
    /// Tools served by directly-connected (native) MCP servers.
    Native(McpToolSet),
    /// Disjoint providers served by the two stacks; native wins name collisions.
    Mixed {
        /// Directly connected providers.
        native: McpToolSet,
        /// Remaining hosted providers.
        pipedream: PipedreamToolSet,
    },
}

impl UserMcpTools {
    /// Returns `true` when no tools were discovered.
    pub fn is_empty(&self) -> bool {
        match self {
            UserMcpTools::Pipedream(tools) => tools.is_empty(),
            UserMcpTools::Native(tools) => tools.is_empty(),
            UserMcpTools::Mixed { native, pipedream } => native.is_empty() && pipedream.is_empty(),
        }
    }

    /// The full catalog of MCP tools for on-demand loading via tool search.
    pub fn catalog(&self) -> Vec<SearchableTool> {
        match self {
            UserMcpTools::Pipedream(tools) => tools.searchable_catalog(),
            UserMcpTools::Native(tools) => tools.searchable_catalog(),
            UserMcpTools::Mixed { native, pipedream } => {
                let mut catalog = native.searchable_catalog();
                let names: HashSet<_> = catalog.iter().map(|tool| tool.name.clone()).collect();
                catalog.extend(
                    pipedream
                        .searchable_catalog()
                        .into_iter()
                        .filter(|tool| !names.contains(&tool.name)),
                );
                catalog
            }
        }
    }
}

impl<Context: Send + Sync + 'static> ToolSet<Context> for UserMcpTools {
    fn dispatch_tool_call<'a>(
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
                tools.dispatch_tool_call(context, request_context, tool_name, json)
            }
            UserMcpTools::Native(tools) => {
                tools.dispatch_tool_call(context, request_context, tool_name, json)
            }
            UserMcpTools::Mixed { native, pipedream } => {
                if native.contains_tool(tool_name) {
                    native.dispatch_tool_call(context, request_context, tool_name, json)
                } else {
                    pipedream.dispatch_tool_call(context, request_context, tool_name, json)
                }
            }
        }
    }

    fn request_schemas(&self) -> Option<Vec<RequestSchema>> {
        match self {
            UserMcpTools::Pipedream(tools) => ToolSet::<Context>::request_schemas(tools),
            UserMcpTools::Native(tools) => ToolSet::<Context>::request_schemas(tools),
            UserMcpTools::Mixed { .. } => {
                let schemas: Vec<_> = self
                    .catalog()
                    .into_iter()
                    .map(|tool| RequestSchema {
                        name: tool.name,
                        description: tool.description,
                        schema: tool.schema,
                    })
                    .collect();
                (!schemas.is_empty()).then_some(schemas)
            }
        }
    }

    fn searchable_catalog(&self) -> Vec<SearchableTool> {
        self.catalog()
    }

    fn searchable_toolset_names(&self) -> Vec<String> {
        match self {
            UserMcpTools::Pipedream(tools) => ToolSet::<Context>::searchable_toolset_names(tools),
            UserMcpTools::Native(tools) => ToolSet::<Context>::searchable_toolset_names(tools),
            UserMcpTools::Mixed { native, pipedream } => {
                let mut names = ToolSet::<Context>::searchable_toolset_names(native);
                names.extend(ToolSet::<Context>::searchable_toolset_names(pipedream));
                names.sort();
                names.dedup();
                names
            }
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
            UserMcpTools::Mixed { native, pipedream } => {
                if native.contains_tool(tool_name) {
                    ToolSet::<Context>::routing_description(native, tool_name)
                } else {
                    ToolSet::<Context>::routing_description(pipedream, tool_name)
                }
            }
        }
    }
}

/// Port for consumers (imports, onboarding) that need per-connector tools
/// or connection state without knowing which stack serves them.
pub trait ConnectorSelect: Send + Sync + 'static {
    /// Load the user's full MCP toolset (all enabled providers, across both stacks).
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
        if !self.pipedream_connection.is_configured() {
            return Vec::new();
        }
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
        let native = self
            .native_store
            .list(user)
            .await
            .inspect_err(|e| tracing::warn!(error = ?e, "failed to list native MCP servers"))
            .unwrap_or_default();
        let (native, pipedream) = select_connections(native, pipedream);
        if native.is_empty() {
            return UserMcpTools::Pipedream(
                PipedreamToolSet::new(&pipedream, self.pipedream_connection.clone()).await,
            );
        }
        if pipedream.is_empty() {
            return UserMcpTools::Native(McpToolSet::new(&native, self.native_store.clone()).await);
        }
        let (native, pipedream) = futures::join!(
            McpToolSet::new(&native, self.native_store.clone()),
            PipedreamToolSet::new(&pipedream, self.pipedream_connection.clone()),
        );
        UserMcpTools::Mixed { native, pipedream }
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn connector_toolset(
        &self,
        user: &MacroUserIdStr<'static>,
        connector: ConnectorRef<'_>,
    ) -> anyhow::Result<Option<UserMcpTools>> {
        let native = self
            .native_store
            .list(user)
            .await
            .map_err(|e| anyhow::anyhow!("mcp store: {e:?}"))?;
        if let Some(record) = native.into_iter().find(|r| native_matches(r, connector)) {
            return Ok(Some(UserMcpTools::Native(
                McpToolSet::new(&[record], self.native_store.clone()).await,
            )));
        }
        let pipedream = self.pipedream_connections(user).await;
        let matching = pipedream
            .iter()
            .filter(|r| r.enabled && connector.matches_pipedream_slug(&r.app_slug))
            .min_by_key(|r| {
                connector
                    .pipedream_app_slugs
                    .iter()
                    .position(|slug| *slug == r.app_slug)
            });
        match matching {
            Some(record) => Ok(Some(UserMcpTools::Pipedream(
                PipedreamToolSet::new(
                    std::slice::from_ref(record),
                    self.pipedream_connection.clone(),
                )
                .await,
            ))),
            None => Ok(None),
        }
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn connector_connected(
        &self,
        user: &MacroUserIdStr<'static>,
        connector: ConnectorRef<'_>,
    ) -> anyhow::Result<bool> {
        let native = self
            .native_store
            .list(user)
            .await
            .map_err(|e| anyhow::anyhow!("mcp store: {e:?}"))?;
        if native.iter().any(|r| native_matches(r, connector)) {
            return Ok(true);
        }
        Ok(self
            .pipedream_connections(user)
            .await
            .iter()
            .any(|r| r.enabled && connector.matches_pipedream_slug(&r.app_slug)))
    }
}

/// Wraps a static [`AsyncToolCollection`] and a set of MCP tools, presenting
/// them as a single toolset to the AI loop.
///
/// `Mcp` defaults to the per-user selection, [`UserMcpTools`]; the in-process
/// agent runtime composes the same way over the servers it was handed.
pub struct CombinedToolSet<T, Mcp = UserMcpTools> {
    static_tools: Arc<AsyncToolCollection<T>>,
    mcp_tools: Mcp,
    eager_mcp_tools: Vec<String>,
}

impl<T, Mcp> CombinedToolSet<T, Mcp> {
    /// Combine the static tools with an already-built MCP toolset.
    pub fn new(static_tools: Arc<AsyncToolCollection<T>>, mcp_tools: Mcp) -> Self {
        Self {
            static_tools,
            mcp_tools,
            eager_mcp_tools: Vec::new(),
        }
    }

    /// Advertise these exact MCP names on the first model request when the
    /// connected servers provide them. All other MCP tools remain searchable.
    pub fn with_eager_mcp_tools(mut self, names: &[&str]) -> Self {
        self.eager_mcp_tools = names.iter().map(|name| (*name).to_owned()).collect();
        self
    }

    fn is_eager(&self, name: &str) -> bool {
        self.eager_mcp_tools.iter().any(|eager| eager == name)
    }
}

impl<T: Send + Sync + 'static, Mcp: ToolSet<T>> ToolSet<T> for CombinedToolSet<T, Mcp> {
    fn dispatch_tool_call<'a>(
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
                .dispatch_tool_call(context, request_context, tool_name, json)
        } else {
            self.static_tools
                .dispatch_tool_call(context, request_context, tool_name, json)
        }
    }

    fn request_schemas(&self) -> Option<Vec<RequestSchema>> {
        if self.eager_mcp_tools.is_empty() {
            return self.static_tools.request_schemas();
        }
        let mut schemas = self.static_tools.request_schemas().unwrap_or_default();
        schemas.extend(
            self.mcp_tools
                .searchable_catalog()
                .into_iter()
                .filter(|tool| self.is_eager(&tool.name))
                .map(|tool| RequestSchema {
                    name: tool.name,
                    description: tool.description,
                    schema: tool.schema,
                }),
        );
        (!schemas.is_empty()).then_some(schemas)
    }

    fn searchable_catalog(&self) -> Vec<SearchableTool> {
        ToolSet::<T>::searchable_catalog(&self.mcp_tools)
            .into_iter()
            // Catalog entries are deferred by providers that use tool search,
            // even when their schemas are also present in request_schemas.
            .filter(|tool| !self.is_eager(&tool.name))
            .collect()
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
