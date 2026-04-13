use ai_toolset::{AsyncToolSet, RequestContext};
use macro_user_id::user_id::MacroUserIdStr;
use rmcp::{
    handler::server::ServerHandler,
    model::{
        Content, ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerInfo, Tool,
    },
};
use std::sync::Arc;

/// MCP server handler that extracts authenticated user identity from HTTP
/// request parts injected by rmcp's `StreamableHttpService`.
pub struct AuthenticatedToolService<Context> {
    toolset: Arc<AsyncToolSet<Context>>,
    context: Context,
}

impl<Context> AuthenticatedToolService<Context> {
    /// Creates a new authenticated tool service.
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
            .map(|(key, value)| {
                Tool::new(
                    key.to_owned(),
                    value.description.to_owned(),
                    Arc::new(value.input_schema.clone()),
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
        let user_id = context
            .extensions
            .get::<http::request::Parts>()
            .and_then(|parts| parts.extensions.get::<MacroUserIdStr<'static>>().cloned())
            .ok_or_else(|| {
                rmcp::ErrorData::internal_error("missing user identity — is auth configured?", None)
            })?;

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
            .map_err(|error| match error {
                ai_toolset::ToolSetError::Deserialization(error) => {
                    rmcp::ErrorData::parse_error(error.to_string(), None)
                }
                ai_toolset::ToolSetError::NotFound(message) => {
                    rmcp::ErrorData::resource_not_found(message, None)
                }
            })?;

        match result {
            Ok(value) => Ok(rmcp::model::CallToolResult::structured(value)),
            Err(error) => Ok(rmcp::model::CallToolResult::error(vec![Content::text(
                error.description,
            )])),
        }
    }
}
