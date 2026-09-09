mod review;

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

/// Per-call context preparation keeps usage attribution tied to the verified user.
pub(crate) trait McpToolContext: Clone + Send + Sync + MarkdownImageResolver {
    fn for_user(&self, user: MacroUserIdStr<'static>) -> Self;
}

impl McpToolContext for ai_tools::ToolServiceContext {
    fn for_user(&self, user: MacroUserIdStr<'static>) -> Self {
        let mut context = self.clone();
        context.usage_context = ai_usage::UsageContext::new(ai_usage::AiFeature::Chat, user);
        context
    }
}

#[cfg(test)]
impl McpToolContext for () {
    fn for_user(&self, _user: MacroUserIdStr<'static>) -> Self {}
}

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
            item_base_url,
        }
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
    Context: McpToolContext + 'static,
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
        Self::authenticated_user_id(&context.extensions)?;

        Ok(ListToolsResult {
            tools: self.tool_definitions(),
            ..Default::default()
        })
    }

    async fn call_tool(
        &self,
        request: rmcp::model::CallToolRequestParams,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<rmcp::model::CallToolResult, rmcp::ErrorData> {
        let user_id = Self::authenticated_user_id(&context.extensions)?;

        let tool_context = self.context.for_user(user_id.clone());
        let mut request_context = RequestContext::new(user_id.clone());
        request_context.cancel = context.ct.clone();

        let arguments = request
            .arguments
            .map(serde_json::Value::Object)
            .ok_or(rmcp::ErrorData::invalid_params("No params provided", None))?;

        if let Some(tool) = self.toolset.user_tools.get(request.name.as_ref()) {
            let supports_form = context
                .peer
                .peer_info()
                .and_then(|info| info.capabilities.elicitation.as_ref())
                .is_some_and(|cap| cap.form.is_some() || cap.url.is_none());
            if !supports_form {
                return Ok(tool_error(
                    "This tool requires form elicitation support; nothing was executed.",
                ));
            }
            let composer = context
                .peer
                .peer_info()
                .and_then(|info| info.capabilities.experimental.as_ref())
                .is_some_and(|caps| caps.contains_key("macro/composer"));
            let schema = if request.name == "SendEmail" && !composer {
                review::email_form(&arguments)
            } else {
                review::project_form(
                    &review::tool_schema(&request.name, &tool.input_schema),
                    &arguments,
                )
            }
            .map_err(|error| rmcp::ErrorData::internal_error(error, None))?;
            let params = rmcp::model::CreateElicitationRequestParams::FormElicitationParams {
                meta: Some(rmcp::model::Meta(
                    serde_json::from_value(serde_json::json!({
                        "macro": {"userTool": {"name": request.name, "draft": arguments}}
                    }))
                    .map_err(|error| rmcp::ErrorData::internal_error(error.to_string(), None))?,
                )),
                message: format!("{}?", tool.annotations.title),
                requested_schema: schema,
            };
            let mut pending = context
                .peer
                .send_cancellable_request(
                    rmcp::model::CreateElicitationRequest::new(params).into(),
                    Default::default(),
                )
                .await
                .map_err(|error| rmcp::ErrorData::internal_error(error.to_string(), None))?;
            let response = tokio::select! {
                biased;
                _ = context.ct.cancelled() => None,
                _ = tokio::time::sleep(std::time::Duration::from_secs(3600)) => None,
                response = &mut pending.rx => Some(response),
            };
            let response = match response {
                None => {
                    let _ = pending
                        .cancel(Some("the review was cancelled or expired".to_owned()))
                        .await;
                    return Ok(tool_error(
                        "The review was cancelled or expired; nothing was executed.",
                    ));
                }
                Some(Ok(Ok(rmcp::model::ClientResult::CreateElicitationResult(response)))) => {
                    response
                }
                _ => return Ok(tool_error("The review failed; nothing was executed.")),
            };
            match response.action {
                rmcp::model::ElicitationAction::Decline => {
                    // MCP structuredContent must be an object. Text preserves
                    // the existing "Rejected" value when the inmem client reads it.
                    return Ok(rmcp::model::CallToolResult::success(vec![Content::text(
                        "Rejected",
                    )]));
                }
                rmcp::model::ElicitationAction::Cancel => {
                    return Ok(tool_error(
                        "The review was cancelled; nothing was executed.",
                    ));
                }
                rmcp::model::ElicitationAction::Accept => {}
            }
            let reviewed = match response
                .content
                .as_ref()
                .ok_or_else(|| "The accepted form had no content".to_owned())
                .and_then(|content| review::reviewed_arguments(&request.name, &arguments, content))
            {
                Ok(args) if self.toolset.is_valid_tool(&request.name, &args) => args,
                _ => {
                    return Ok(tool_error(
                        "The reviewed arguments are invalid; nothing was executed.",
                    ));
                }
            };
            if context.ct.is_cancelled() {
                return Ok(tool_error("The call was cancelled before execution."));
            }
            return match self
                .toolset
                .try_user_tool_call(tool_context, request_context, &request.name, &reviewed)
                .await
            {
                Ok(Ok(result)) => {
                    let value = serde_json::to_value(result).map_err(|error| {
                        rmcp::ErrorData::internal_error(error.to_string(), None)
                    })?;
                    Ok(tool_result_with_images(&self.context, &user_id, value).await)
                }
                Ok(Err(error)) => Ok(tool_error(error.description)),
                Err(error) => Ok(tool_error(error.to_string())),
            };
        }

        let result = self
            .toolset
            .try_tool_call(tool_context, request_context, &request.name, &arguments)
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
            Ok(value) => Ok(tool_result_with_images(&self.context, &user_id, value).await),
            Err(error) => Ok(rmcp::model::CallToolResult::error(vec![Content::text(
                error.description,
            )])),
        }
    }
}

fn tool_error(message: impl Into<String>) -> rmcp::model::CallToolResult {
    rmcp::model::CallToolResult::error(vec![Content::text(message.into())])
}
