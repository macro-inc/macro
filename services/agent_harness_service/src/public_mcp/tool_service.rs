use crate::public_mcp::markdown_images::MarkdownImageResolver;
use crate::public_mcp::request_observer::{
    HANDOFF_TOOLS, InitializeSeen, NoObserver, RequestObserver, ToolCallSeen,
};
use crate::public_mcp::setup_prompt::SetupHintSource;
use crate::public_mcp::telemetry::{ClientInfo, ToolCallOutcome};
use crate::public_mcp::tool_response::tool_result_with_media;
use ai_toolset::{AsyncToolCollection, RequestContext, ToolSet};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_auth_proxy::inbound::middleware::JwtAccessToken;
use prompt::mcp_setup::SetupHint;
use rmcp::{
    handler::server::ServerHandler,
    model::{
        Content, GetPromptRequestParams, GetPromptResult, Icon, InitializeRequestParams,
        InitializeResult, ListPromptsResult, ListToolsResult, PaginatedRequestParams,
        ServerCapabilities, ServerInfo, Tool, ToolAnnotations,
    },
};
use std::{sync::Arc, time::Instant};
use tracing::Instrument;

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
    /// Static file CDN used for attachments returned by authorized channel reads.
    static_file_base_url: url::Url,
    /// Told about handshakes and tool calls, for analytics.
    observer: Arc<dyn RequestObserver>,
    /// Agent-led setup, when it's switched on: whether a person needs setup,
    /// so the instructions lead with it only for them. `None` serves the
    /// instructions and capabilities MCP clients had before agent-led setup.
    setup: Option<Arc<dyn SetupHintSource>>,
}

/// What MCP clients were told before agent-led setup, ahead of the shared
/// rules. Served unchanged while setup is switched off.
const LEGACY_INSTRUCTIONS_PREAMBLE: &str = "This server provides tools for interacting with a user's Macro workspace. \
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
     Use ListEntities to browse recent items.";

impl<Context> AuthenticatedToolService<Context> {
    /// Creates a new authenticated tool service.
    pub fn new(
        toolset: Arc<AsyncToolCollection<Context>>,
        context: Context,
        item_base_url: String,
        static_file_base_url: url::Url,
    ) -> Self {
        Self {
            toolset,
            context,
            item_base_url,
            static_file_base_url,
            observer: Arc::new(NoObserver),
            setup: None,
        }
    }

    /// Switches agent-led setup on: the `setup` prompt, and instructions that
    /// lead with setup for the people `setup_hint` says need it.
    pub fn with_agent_setup(mut self, setup_hint: Arc<dyn SetupHintSource>) -> Self {
        self.setup = Some(setup_hint);
        self
    }

    /// Reports handshakes and tool calls to `observer`.
    pub fn with_observer(mut self, observer: Arc<dyn RequestObserver>) -> Self {
        self.observer = observer;
        self
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

    /// The bearer token and `User-Agent` the request arrived with.
    fn request_credentials(
        extensions: &rmcp::model::Extensions,
    ) -> (Option<String>, Option<String>) {
        let Some(parts) = extensions.get::<http::request::Parts>() else {
            return (None, None);
        };
        let token = parts
            .extensions
            .get::<JwtAccessToken>()
            .map(|token| token.0.clone());
        let user_agent = parts
            .headers
            .get(http::header::USER_AGENT)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        (token, user_agent)
    }

    /// Server info with instructions tailored to the person's setup, or the
    /// pre-setup instructions when `setup` is `None` (setup switched off).
    fn server_info(&self, setup: Option<SetupHint>) -> ServerInfo {
        let capabilities = match setup {
            Some(_) => ServerCapabilities::builder()
                .enable_prompts()
                .enable_tools()
                .build(),
            None => ServerCapabilities::builder().enable_tools().build(),
        };
        let mut info = ServerInfo::new(capabilities);
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
        info.instructions = Some(match setup {
            Some(setup) => prompt::mcp_instructions_for(base_url, setup),
            None => format!(
                "{LEGACY_INSTRUCTIONS_PREAMBLE}\n\n{}",
                prompt::legacy_mcp_instructions(base_url)
            ),
        });
        info
    }
}

/// The analytics class of a request-level failure.
fn error_kind(error: &rmcp::ErrorData) -> &'static str {
    match error.code {
        rmcp::model::ErrorCode::PARSE_ERROR => "parse_error",
        rmcp::model::ErrorCode::INVALID_PARAMS => "invalid_params",
        rmcp::model::ErrorCode::RESOURCE_NOT_FOUND => "unknown_tool",
        _ => "request_error",
    }
}

/// How a `tools/call` ended, for analytics.
fn tool_call_outcome(
    result: &Result<rmcp::model::CallToolResult, rmcp::ErrorData>,
) -> ToolCallOutcome {
    match result {
        Ok(result) if result.is_error == Some(true) => {
            ToolCallOutcome::Error { kind: "tool_error" }
        }
        Ok(_) => ToolCallOutcome::Success,
        Err(error) => ToolCallOutcome::Error {
            kind: error_kind(error),
        },
    }
}

#[cfg(test)]
mod test;

impl<Context> ServerHandler for AuthenticatedToolService<Context>
where
    Context: Clone + Send + Sync + MarkdownImageResolver + 'static,
{
    fn get_info(&self) -> ServerInfo {
        self.server_info(self.setup.as_ref().map(|_| SetupHint::Unknown))
    }

    async fn initialize(
        &self,
        request: InitializeRequestParams,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<InitializeResult, rmcp::ErrorData> {
        let user_id = Self::authenticated_user_id(&context.extensions)?;
        let (token, user_agent) = Self::request_credentials(&context.extensions);
        let seen = InitializeSeen {
            user_id: user_id.as_ref().to_owned(),
            token,
            client: ClientInfo {
                name: Some(request.client_info.name.clone()),
                version: Some(request.client_info.version.clone()),
                user_agent,
            },
            protocol_version: request.protocol_version.to_string(),
        };
        tokio::spawn(
            Arc::clone(&self.observer)
                .initialized(seen)
                .in_current_span(),
        );
        if context.peer.peer_info().is_none() {
            context.peer.set_peer_info(request);
        }
        let setup = match &self.setup {
            Some(source) => Some(source.hint(user_id).await),
            None => None,
        };
        Ok(self.server_info(setup))
    }

    async fn list_prompts(
        &self,
        _request: Option<PaginatedRequestParams>,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<ListPromptsResult, rmcp::ErrorData> {
        Self::authenticated_user_id(&context.extensions)?;
        Ok(ListPromptsResult::with_all_items(match self.setup {
            Some(_) => crate::public_mcp::setup_prompt::prompts(),
            None => Vec::new(),
        }))
    }

    async fn get_prompt(
        &self,
        request: GetPromptRequestParams,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<GetPromptResult, rmcp::ErrorData> {
        Self::authenticated_user_id(&context.extensions)?;
        let prompt = match self.setup {
            Some(_) => crate::public_mcp::setup_prompt::get(&request),
            None => None,
        };
        prompt.ok_or_else(|| {
            rmcp::ErrorData::invalid_params(
                format!(
                    "Unknown prompt \"{}\". prompts/list has the prompts this server offers.",
                    request.name
                ),
                None,
            )
        })
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
        let (token, user_agent) = Self::request_credentials(&context.extensions);
        let tool_name = request.name.to_string();
        let started = Instant::now();

        let result = self.dispatch_tool_call(user_id.clone(), request).await;

        let handoff_result = match &result {
            Ok(result) if HANDOFF_TOOLS.contains(&tool_name.as_str()) => {
                result.structured_content.clone()
            }
            _ => None,
        };
        tokio::spawn(
            Arc::clone(&self.observer)
                .tool_called(ToolCallSeen {
                    user_id: user_id.as_ref().to_owned(),
                    token,
                    user_agent,
                    tool_name,
                    duration: started.elapsed(),
                    outcome: tool_call_outcome(&result),
                    handoff_result,
                })
                .in_current_span(),
        );
        result
    }
}

impl<Context> AuthenticatedToolService<Context>
where
    Context: Clone + Send + Sync + MarkdownImageResolver + 'static,
{
    /// Runs one tool for an authenticated user.
    async fn dispatch_tool_call(
        &self,
        user_id: MacroUserIdStr<'static>,
        request: rmcp::model::CallToolRequestParams,
    ) -> Result<rmcp::model::CallToolResult, rmcp::ErrorData> {
        let request_context = RequestContext::new(user_id.clone());

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
            Ok(value) => Ok(tool_result_with_media(
                &self.context,
                &user_id,
                &request.name,
                &self.static_file_base_url,
                value,
            )
            .await),
            Err(error) => Ok(rmcp::model::CallToolResult::error(vec![Content::text(
                error.description,
            )])),
        }
    }
}
