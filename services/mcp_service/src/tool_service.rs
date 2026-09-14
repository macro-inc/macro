use crate::markdown_images::{MarkdownImageResolver, tool_result_with_images};
use ai_toolset::{AsyncToolCollection, RequestContext, ToolSet};
use macro_user_id::user_id::MacroUserIdStr;
use rmcp::{
    handler::server::ServerHandler,
    model::{
        Content, Icon, ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerInfo,
        Tool, ToolAnnotations,
    },
};
use std::sync::Arc;

/// Maps our protocol-agnostic annotations onto the MCP wire representation.
///
/// [`ToolKind`](ai_toolset::ToolKind) collapses `readOnlyHint`/`destructiveHint`
/// into one choice, so this is the only place the two booleans are derived —
/// they can never disagree.
fn mcp_annotations(annotations: &ai_toolset::ToolAnnotations) -> ToolAnnotations {
    ToolAnnotations::with_title(annotations.title)
        .read_only(annotations.kind.read_only_hint())
        .destructive(annotations.kind.destructive_hint())
        .idempotent(annotations.idempotent)
        .open_world(annotations.open_world)
}

/// MCP server handler that extracts authenticated user identity from HTTP
/// request parts injected by rmcp's `StreamableHttpService`.
#[allow(
    dead_code,
    reason = "fields used via ServerHandler trait impl dispatched by rmcp"
)]
pub struct AuthenticatedToolService<Context> {
    toolset: Arc<AsyncToolCollection<Context>>,
    context: Context,
    session_tools: Option<Arc<dyn agent_session::domain::pull_request::SessionPullRequests>>,
    /// Base URL of the Macro web app used to build links to Macro items in MCP
    /// responses (e.g. `https://macro.com`). Comes from the `APP_BASE_URL`
    /// environment variable.
    item_base_url: String,
}

impl<Context> AuthenticatedToolService<Context> {
    /// Creates a new authenticated tool service.
    pub fn new(
        toolset: Arc<AsyncToolCollection<Context>>,
        context: Context,
        item_base_url: String,
    ) -> Self {
        Self {
            toolset,
            context,
            session_tools: None,
            item_base_url,
        }
    }

    /// Add tools whose session comes from a verified egress credential.
    pub fn with_session_tools(
        mut self,
        service: Arc<dyn agent_session::domain::pull_request::SessionPullRequests>,
    ) -> Self {
        self.session_tools = Some(service);
        self
    }

    async fn session_context(
        &self,
        extensions: &rmcp::model::Extensions,
        user: &MacroUserIdStr<'static>,
    ) -> Result<agent_session::inbound::toolset::SessionToolContext, rmcp::ErrorData> {
        let forbidden = || {
            rmcp::ErrorData::invalid_request(
                "set_pull_request requires an active sandbox session",
                None,
            )
        };
        let service = self.session_tools.as_ref().ok_or_else(forbidden)?;
        let token = extensions
            .get::<http::request::Parts>()
            .and_then(|parts| {
                parts
                    .headers
                    .get(agent_egress::domain::model::MACRO_SESSION_TOKEN_HEADER)
            })
            .and_then(|value| value.to_str().ok())
            .ok_or_else(forbidden)?;
        let hash = agent_egress::domain::model::SessionToken::new(token).hash();
        let session = service
            .tool_session(&hash, user)
            .await
            .map_err(|_| forbidden())?;
        Ok(agent_session::inbound::toolset::SessionToolContext {
            service: service.clone(),
            session,
        })
    }

    fn tool_definitions(&self) -> Vec<Tool> {
        self.toolset
            .tools
            .iter()
            .map(|(key, value)| {
                Tool::new(
                    key.to_owned(),
                    value.description.to_owned(),
                    Arc::new(value.input_schema.clone()),
                )
                .with_title(value.annotations.title)
                .annotate(mcp_annotations(&value.annotations))
            })
            .collect()
    }

    fn authenticated_user_id(
        extensions: &rmcp::model::Extensions,
    ) -> Result<MacroUserIdStr<'static>, rmcp::ErrorData> {
        extensions
            .get::<http::request::Parts>()
            .and_then(|parts| parts.extensions.get::<MacroUserIdStr<'static>>().cloned())
            .ok_or_else(|| {
                rmcp::ErrorData::internal_error("missing user identity — is auth configured?", None)
            })
    }
}

#[cfg(test)]
mod test;

impl<Context> ServerHandler for AuthenticatedToolService<Context>
where
    Context: Clone + Send + Sync + MarkdownImageResolver + 'static,
{
    fn get_info(&self) -> ServerInfo {
        let mut info = ServerInfo::new(ServerCapabilities::builder().enable_tools().build());
        let base_url = self.item_base_url.trim_end_matches('/');
        info.server_info = rmcp::model::Implementation::new(
            "macro-tools",
            env!("CARGO_PKG_VERSION"),
        )
        .with_title("Macro")
        .with_description(
            "Search, read, and create content across documents, emails, and messages in Macro.",
        )
        // The same icon the web app's <link rel="icon"> points at, so the
        // server shows up in MCP clients with the Macro favicon.
        .with_icons(vec![
            Icon::new(format!("{base_url}/app/macro-favicon.svg"))
                .with_mime_type("image/svg+xml")
                .with_sizes(vec!["any".to_owned()]),
        ]);
        info.instructions = Some(format!(
            "This server provides tools for interacting with a user's Macro workspace. \
             Use ContentSearch and NameSearch to find entities. \
             Use ReadContent, ReadMetadata, and ReadThread to read them. \
             Use CreateDocument to create new documents. \
             Use EditDocument to edit existing documents. \
             Use ListEntities to browse recent items.\n\n{}",
            prompt::mcp_instructions(base_url),
        ));
        info
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<ListToolsResult, rmcp::ErrorData> {
        let user = Self::authenticated_user_id(&context.extensions)?;
        let mut tools = self.tool_definitions();
        if self
            .session_context(&context.extensions, &user)
            .await
            .is_ok()
        {
            tools.extend(session_toolset().tools.iter().map(|(name, tool)| {
                Tool::new(
                    name.clone(),
                    tool.description.clone(),
                    Arc::new(tool.input_schema.clone()),
                )
                .with_title(tool.annotations.title)
                .annotate(mcp_annotations(&tool.annotations))
            }));
        }
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
        let user_id = Self::authenticated_user_id(&context.extensions)?;

        let request_context = RequestContext::new(user_id.clone());

        let arguments = request
            .arguments
            .map(serde_json::Value::Object)
            .ok_or(rmcp::ErrorData::invalid_params("No params provided", None))?;

        let result = if request.name.as_ref() == "set_pull_request" {
            let session = self.session_context(&context.extensions, &user_id).await?;
            session_toolset()
                .try_tool_call(session, request_context, &request.name, &arguments)
                .await
        } else {
            self.toolset
                .try_tool_call(
                    self.context.clone(),
                    request_context,
                    &request.name,
                    &arguments,
                )
                .await
        }
        .map_err(|error| match error {
            ai_toolset::ToolSetError::Deserialization(error) => {
                rmcp::ErrorData::parse_error(error.to_string(), None)
            }
            ai_toolset::ToolSetError::NotFound(message) => {
                rmcp::ErrorData::resource_not_found(message, None)
            }
        })?;

        match result {
            Ok(value) => Ok(tool_result_with_images(&self.context, &user_id, value).await),
            Err(error) => Ok(rmcp::model::CallToolResult::error(vec![Content::text(
                error.description,
            )])),
        }
    }
}

/// These tools are absent from ordinary MCP and chat catalogs: each invocation
/// requires the calling sandbox's session credential.
fn session_toolset() -> AsyncToolCollection<agent_session::inbound::toolset::SessionToolContext> {
    AsyncToolCollection::new().add_tool::<agent_session::inbound::toolset::SetPullRequest, agent_session::inbound::toolset::SessionToolContext>()
}
