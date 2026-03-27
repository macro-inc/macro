use ai_toolset::{AsyncToolSet, RequestContext};
use macro_user_id::user_id::MacroUserIdStr;
use rmcp::{
    handler::server::ServerHandler,
    model::{
        Content, ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerInfo, Tool,
    },
};
use std::sync::Arc;

use super::middleware::McpUserIdentity;

/// MCP server handler that extracts authenticated user identity from HTTP
/// request parts injected by rmcp's `StreamableHttpService`.
pub struct AuthenticatedToolService<Context> {
    toolset: Arc<AsyncToolSet<Context>>,
    context: Context,
}

impl<Context> AuthenticatedToolService<Context> {
    /// Create a new authenticated tool service.
    pub fn new(toolset: Arc<AsyncToolSet<Context>>, context: Context) -> Self {
        Self { toolset, context }
    }
}

impl<Context> ServerHandler for AuthenticatedToolService<Context>
where
    Context: Clone + Send + Sync + 'static,
{
    fn get_info(&self) -> ServerInfo {
        let mut info = ServerInfo::new(ServerCapabilities::builder().enable_tools().build());
        info.server_info = rmcp::model::Implementation::new(
            "macro-tools",
            env!("CARGO_PKG_VERSION"),
        )
        .with_title("Macro")
        .with_description(
            "Search, read, and create content across documents, emails, and messages in Macro.",
        );
        info.instructions = Some(
            "This server provides tools for interacting with a user's Macro workspace. \
             Use ContentSearch and NameSearch to find entities. \
             Use ReadContent, ReadMetadata, and ReadThread to read them. \
             Use CreateDocument to create new documents. \
             Use ListEntities to browse recent items."
                .into(),
        );
        info
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<ListToolsResult, rmcp::ErrorData> {
        let tools = self
            .toolset
            .tools
            .iter()
            .map(|(k, v)| {
                Tool::new(
                    k.to_owned(),
                    v.description.to_owned(),
                    Arc::new(v.input_schema.clone()),
                )
            })
            .collect::<Vec<_>>();

        Ok(ListToolsResult {
            tools,
            ..Default::default()
        })
    }

    async fn call_tool(
        &self,
        request: rmcp::model::CallToolRequestParams,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<rmcp::model::CallToolResult, rmcp::ErrorData> {
        // Extract user identity from HTTP parts injected by rmcp.
        let identity = context
            .extensions
            .get::<http::request::Parts>()
            .and_then(|parts| parts.extensions.get::<McpUserIdentity>().cloned())
            .ok_or_else(|| {
                rmcp::ErrorData::internal_error("missing user identity — is auth configured?", None)
            })?;

        let user_id = MacroUserIdStr::try_from(identity.user_id.clone())
            .map_err(|e| rmcp::ErrorData::internal_error(format!("invalid user id: {e}"), None))?;

        let request_context = RequestContext { user_id };

        let arguments = request
            .arguments
            .map(serde_json::Value::Object)
            .ok_or(rmcp::ErrorData::invalid_params("No params provided", None))?;

        let result = self
            .toolset
            .try_tool_call(
                self.context.clone(),
                request_context,
                &request.name,
                &arguments,
            )
            .await
            .map_err(|e| match e {
                ai_toolset::ToolSetError::Deserialization(e) => {
                    rmcp::ErrorData::parse_error(e.to_string(), None)
                }
                ai_toolset::ToolSetError::NotFound(s) => {
                    rmcp::ErrorData::resource_not_found(s, None)
                }
            })?;

        match result {
            Ok(good) => Ok(rmcp::model::CallToolResult::structured(good)),
            Err(bad) => Ok(rmcp::model::CallToolResult::error(vec![Content::text(
                bad.description,
            )])),
        }
    }
}
