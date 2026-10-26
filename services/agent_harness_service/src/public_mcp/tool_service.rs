use crate::public_mcp::analytics::{
    McpAnalytics, McpAnalyticsEvent, McpClientSignals, SERVER_NAME, ToolCallOutcome,
};
use crate::public_mcp::markdown_images::MarkdownImageResolver;
use crate::public_mcp::tool_response::tool_result_with_media;
use agent_code_mode::inbound::toolset::UserCodeModeToolContext;
use agent_inmem::domain::tool_mode::{ToolMode, ToolModeSelector};
use ai_toolset::{AsyncToolCollection, RequestContext, ToolSet};
use macro_user_id::user_id::MacroUserIdStr;
use rmcp::{
    handler::server::ServerHandler,
    model::{
        CallToolResult, Content, Icon, InitializeRequestParams, InitializeResult, ListToolsResult,
        PaginatedRequestParams, ServerCapabilities, ServerInfo, Tool, ToolAnnotations,
    },
};
use std::{sync::Arc, time::Instant};

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

fn definitions<Context>(toolset: &AsyncToolCollection<Context>) -> impl Iterator<Item = Tool> + '_ {
    toolset.tools.iter().map(|(key, value)| {
        Tool::new(
            key.to_owned(),
            value.description.to_owned(),
            Arc::new(value.input_schema.clone()),
        )
        .with_title(value.annotations.title)
        .annotate(mcp_annotations(&value.annotations))
    })
}

/// Code mode for flagged users: SDK-covered native tools give way to the SDK.
pub struct CodeModeSurface<Context> {
    /// Native tools still listed in code mode, from `tools_for_mcp_code_mode`.
    pub native: Arc<AsyncToolCollection<Context>>,
    /// `ExecuteCode` and `DescribeCodeTools`.
    pub tools: Arc<AsyncToolCollection<UserCodeModeToolContext>>,
    /// User-scoped execution and Jev.
    pub context: UserCodeModeToolContext,
    /// The `ai-code-mode` flag, per user.
    pub selector: Arc<dyn ToolModeSelector>,
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
    /// responses (e.g. `https://macro.com`). Resolved at startup from `AppServiceUrl`.
    item_base_url: String,
    /// Static file CDN used for attachments returned by authorized channel reads.
    static_file_base_url: url::Url,
    /// Present when this deployment can run code.
    code_mode: Option<Arc<CodeModeSurface<Context>>>,
    /// Records sessions and tool calls to product analytics.
    analytics: McpAnalytics,
}

impl<Context> AuthenticatedToolService<Context> {
    /// Creates a new authenticated tool service.
    pub fn new(
        toolset: Arc<AsyncToolCollection<Context>>,
        context: Context,
        item_base_url: String,
        static_file_base_url: url::Url,
        analytics: McpAnalytics,
    ) -> Self {
        Self {
            toolset,
            context,
            item_base_url,
            static_file_base_url,
            code_mode: None,
            analytics,
        }
    }

    /// Offer code mode to users with the `ai-code-mode` flag.
    pub fn with_code_mode(mut self, code_mode: Arc<CodeModeSurface<Context>>) -> Self {
        self.code_mode = Some(code_mode);
        self
    }

    fn tool_definitions(&self) -> Vec<Tool> {
        definitions(&self.toolset).collect()
    }

    /// Tools listed for a mode. Code mode lists the reduced native set plus the
    /// SDK tools; every native tool stays callable either way.
    fn tool_definitions_for(&self, mode: ToolMode) -> Vec<Tool> {
        match (mode, &self.code_mode) {
            (ToolMode::Code, Some(code_mode)) => definitions(&code_mode.native)
                .chain(definitions(&code_mode.tools))
                .collect(),
            _ => self.tool_definitions(),
        }
    }

    async fn tool_mode(&self, user_id: &MacroUserIdStr<'static>) -> ToolMode {
        match &self.code_mode {
            Some(code_mode) => code_mode.selector.select(user_id).await,
            None => ToolMode::Standard,
        }
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

    fn client_signals(extensions: &rmcp::model::Extensions) -> McpClientSignals {
        McpClientSignals::from_request_parts(extensions.get::<http::request::Parts>())
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
        info.server_info = rmcp::model::Implementation::new(SERVER_NAME, env!("CARGO_PKG_VERSION"))
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
             Use ReadContent and ReadMetadata for documents, ReadAgentSession for agent-session conversations. \
             Use ReadChannelMessages, ReadChannelThread, and ReadChannelMessageContext \
             to read channel messages and their attachments. Channel image attachments \
             include inline images when available; image and video attachments include \
             downloadable URLs. Use a video-capable tool to inspect video URLs. \
             Use CreateDocument to create new documents. \
             Use EditDocument to edit existing documents. \
             Use ListSkills to discover available skills, SearchSkills to find a skill by name, \
             and ReadSkill to read its full instructions before following them for the current request. \
             Use ListEntities to browse recent items.\n\n{}",
            prompt::mcp_instructions(base_url),
        ));
        info
    }

    async fn initialize(
        &self,
        request: InitializeRequestParams,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<InitializeResult, rmcp::ErrorData> {
        let user_id = Self::authenticated_user_id(&context.extensions)?;
        // `initialize` is the only message that names the client, so it is
        // where sessions are counted per client.
        self.analytics.record(
            user_id.clone(),
            Self::client_signals(&context.extensions),
            McpAnalyticsEvent::Initialize {
                client_name: request.client_info.name.clone(),
                client_version: request.client_info.version.clone(),
                protocol_version: request.protocol_version.to_string(),
            },
        );
        if context.peer.peer_info().is_none() {
            context.peer.set_peer_info(request);
        }
        let mut info = self.get_info();
        if self.tool_mode(&user_id).await == ToolMode::Code
            && let Some(instructions) = info.instructions.as_mut()
        {
            instructions.push_str("\n\n");
            instructions.push_str(include_str!("code_mode_instructions.md"));
        }
        Ok(info)
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<ListToolsResult, rmcp::ErrorData> {
        let user_id = Self::authenticated_user_id(&context.extensions)?;
        let mode = self.tool_mode(&user_id).await;

        Ok(ListToolsResult {
            tools: self.tool_definitions_for(mode),
            ..Default::default()
        })
    }

    async fn call_tool(
        &self,
        request: rmcp::model::CallToolRequestParams,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<rmcp::model::CallToolResult, rmcp::ErrorData> {
        let user_id = Self::authenticated_user_id(&context.extensions)?;
        let started = Instant::now();
        // Bounded: an unknown tool's name is whatever the client sent.
        let tool_name = request.name.chars().take(128).collect();

        let (outcome, result) = self.run_tool(user_id.clone(), request, &context).await;

        self.analytics.record(
            user_id,
            Self::client_signals(&context.extensions),
            McpAnalyticsEvent::ToolCall {
                tool_name,
                outcome,
                duration: started.elapsed(),
            },
        );
        result
    }
}

impl<Context> AuthenticatedToolService<Context>
where
    Context: Clone + Send + Sync + MarkdownImageResolver + 'static,
{
    /// Runs one tool call and classifies how it ended, for analytics.
    async fn run_tool(
        &self,
        user_id: MacroUserIdStr<'static>,
        request: rmcp::model::CallToolRequestParams,
        context: &rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> (
        ToolCallOutcome,
        Result<rmcp::model::CallToolResult, rmcp::ErrorData>,
    ) {
        let mut request_context = RequestContext::new(user_id.clone());

        let Some(arguments) = request.arguments.map(serde_json::Value::Object) else {
            return (
                ToolCallOutcome::InvalidRequest,
                Err(rmcp::ErrorData::invalid_params("No params provided", None)),
            );
        };

        if let Some(code_mode) = &self.code_mode
            && code_mode.tools.tools.contains_key(request.name.as_ref())
        {
            if self.tool_mode(&user_id).await != ToolMode::Code {
                return (
                    ToolCallOutcome::InvalidRequest,
                    Err(rmcp::ErrorData::resource_not_found(
                        format!("tool {} not found", request.name),
                        None,
                    )),
                );
            }
            request_context.cancel = context.ct.clone();
            let result = match code_mode
                .tools
                .try_tool_call(
                    code_mode.context.clone(),
                    request_context,
                    &request.name,
                    &arguments,
                )
                .await
            {
                Ok(result) => result,
                Err(error) => {
                    return (
                        ToolCallOutcome::InvalidRequest,
                        Err(rmcp::ErrorData::invalid_params(error.to_string(), None)),
                    );
                }
            };
            return match result {
                Ok(value) => (
                    ToolCallOutcome::Success,
                    Ok(CallToolResult::structured(value)),
                ),
                // A failed program is a completed execution with a receipt.
                Err(error) => (
                    ToolCallOutcome::ToolError,
                    Ok(CallToolResult::error(vec![Content::text(
                        error.description,
                    )])),
                ),
            };
        }

        let result = match self
            .toolset
            .try_tool_call(
                self.context.clone(),
                request_context,
                &request.name,
                &arguments,
            )
            .await
        {
            Ok(result) => result,
            Err(ai_toolset::ToolSetError::Deserialization(error)) => {
                return (
                    ToolCallOutcome::InvalidRequest,
                    Err(rmcp::ErrorData::parse_error(error.to_string(), None)),
                );
            }
            Err(ai_toolset::ToolSetError::NotFound(message)) => {
                return (
                    ToolCallOutcome::InvalidRequest,
                    Err(rmcp::ErrorData::resource_not_found(message, None)),
                );
            }
        };

        match result {
            Ok(value) => (
                ToolCallOutcome::Success,
                Ok(tool_result_with_media(
                    &self.context,
                    &user_id,
                    &request.name,
                    &self.static_file_base_url,
                    value,
                )
                .await),
            ),
            Err(error) => (
                ToolCallOutcome::ToolError,
                Ok(rmcp::model::CallToolResult::error(vec![Content::text(
                    error.description,
                )])),
            ),
        }
    }
}
