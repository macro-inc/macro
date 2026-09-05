use crate::domain::models::PipedreamConnection;
use crate::domain::ports::McpConnection;
use ai_toolset::{
    RequestContext, RequestSchema, SearchableTool, ToolInfo, ToolResult, ToolSet, ToolSetError,
};
use mcp_toolset::{ConnectedServer, RemoteMcpToolSet};
use std::pin::Pin;
use std::sync::Arc;

/// The tools of a user's Pipedream-connected apps.
///
/// Connecting is this crate's business - one session per enabled app through
/// Pipedream's remote MCP server, which injects the account's credentials
/// server-side. Everything after the connections are open (tool discovery,
/// name mangling, dispatch) is [`RemoteMcpToolSet`]'s, shared with every
/// other MCP-backed toolset.
pub struct PipedreamToolSet(RemoteMcpToolSet);

impl PipedreamToolSet {
    /// Connect to every enabled app in `records` concurrently, discover
    /// tools, and register them.
    ///
    /// Apps that fail to connect or list tools are skipped with a warning.
    #[tracing::instrument(skip_all)]
    pub async fn new<C: McpConnection>(
        records: &[PipedreamConnection],
        connection: Arc<C>,
    ) -> Self {
        let user_id = records.first().map(|r| r.user_id.to_string());

        let futs = records.iter().filter(|r| r.enabled).map(|record| {
            let connection = connection.clone();
            async move {
                let client = connection
                    .connect(record)
                    .await
                    .inspect_err(|e| {
                        tracing::warn!(
                            user_id = %record.user_id,
                            server = %record.server_name,
                            app = %record.app_slug,
                            error = ?e,
                            "failed to connect"
                        );
                    })
                    .ok()?;
                Some(ConnectedServer {
                    name: record.server_name.clone(),
                    client,
                })
            }
        });
        let servers: Vec<ConnectedServer> = futures::future::join_all(futs)
            .await
            .into_iter()
            .flatten()
            .collect();

        Self(RemoteMcpToolSet::from_connected(servers, user_id).await)
    }

    /// Returns `true` when no tools were discovered.
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// The full catalog of MCP tools, public for hosts that compose this
    /// toolset (see the `mcp_select` crate).
    pub fn searchable_catalog(&self) -> Vec<SearchableTool> {
        self.0.searchable_catalog()
    }
}

impl<Context: Send + Sync + 'static> ToolSet<Context> for PipedreamToolSet {
    fn try_tool_call<'a>(
        &'a self,
        context: Context,
        request_context: RequestContext,
        tool_name: &'a str,
        json: &'a serde_json::Value,
    ) -> Pin<
        Box<dyn Future<Output = Result<ToolResult<serde_json::Value>, ToolSetError>> + 'a + Send>,
    > {
        self.0
            .try_tool_call(context, request_context, tool_name, json)
    }

    fn request_schemas(&self) -> Option<Vec<RequestSchema>> {
        ToolSet::<Context>::request_schemas(&self.0)
    }

    fn searchable_catalog(&self) -> Vec<SearchableTool> {
        self.0.searchable_catalog()
    }

    fn searchable_toolset_names(&self) -> Vec<String> {
        ToolSet::<Context>::searchable_toolset_names(&self.0)
    }

    fn routing_description<'a>(&'a self, tool_name: &'a str) -> Option<ToolInfo> {
        ToolSet::<Context>::routing_description(&self.0, tool_name)
    }
}
