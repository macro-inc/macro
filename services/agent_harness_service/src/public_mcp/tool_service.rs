use crate::public_mcp::analytics::{
    McpAnalytics, McpAnalyticsEvent, McpClientSignals, SERVER_NAME, ToolCallOutcome,
};
use crate::public_mcp::markdown_images::MarkdownImageResolver;
use crate::public_mcp::tool_response::tool_result_with_media;
use agent_code_mode::{domain::UserCodeMode, inbound::toolset::UserCodeModeToolContext};
use agent_inmem::domain::tool_mode::ToolMode;
use ai_toolset::ToolCaller;
use ai_toolset::{AsyncToolCollection, RequestContext, ToolSet};
use cognition::domain::Cognition;
use macro_user_id::user_id::MacroUserIdStr;
use rmcp::{
    handler::server::ServerHandler,
    model::{
        CacheScope, CallToolResult, ContentBlock, DiscoverResult, Icon, InitializeRequestParams,
        InitializeResult, ListToolsResult, PaginatedRequestParams, ProtocolVersion,
        ServerCapabilities, ServerConfig, Tool, ToolAnnotations,
    },
};
use std::{borrow::Cow, sync::Arc, time::Instant};

/// The newest MCP protocol revision this server answers. Raising it opts the
/// server into that revision's lifecycle (2026-07-28 replaced `initialize` with
/// `server/discover`): first teach the test `every_handshake_describes_the_listed_tools`
/// its handshake, and make sure each one serves `instructions` for the caller's mode.
const NEWEST_PROTOCOL_VERSION: ProtocolVersion = ProtocolVersion::V_2026_07_28;

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

/// A tool context that runs its tools for the caller the request authenticated.
pub trait CalledBy {
    /// Run mutating tools for `caller`, still on the authenticated user's behalf.
    fn called_by(self, caller: &ToolCaller) -> impl Future<Output = Self> + Send;
}

impl CalledBy for ai_tools::ToolServiceContext {
    async fn called_by(self, caller: &ToolCaller) -> Self {
        self.for_caller(caller).await
    }
}

impl CalledBy for () {
    async fn called_by(self, _caller: &ToolCaller) -> Self {}
}

/// Code mode: `tools/list` is the SDK entrypoints only.
pub struct CodeModeSurface {
    /// `ExecuteCode`, `DescribeCodeTools` and `ReadCodeDocs`.
    pub tools: Arc<AsyncToolCollection<UserCodeModeToolContext>>,
    /// User-scoped execution.
    pub service: Arc<dyn UserCodeMode>,
    /// Jev, for selecting documentation by task.
    pub cognition: Option<Arc<dyn Cognition>>,
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
    code_mode: Option<Arc<CodeModeSurface>>,
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

    /// Offer code mode to every client that accepts it.
    pub fn with_code_mode(mut self, code_mode: Arc<CodeModeSurface>) -> Self {
        self.code_mode = Some(code_mode);
        self
    }

    fn tool_definitions(&self) -> Vec<Tool> {
        definitions(&self.toolset).collect()
    }

    /// Tools listed for a mode. Code mode lists only its own tools
    /// (`ExecuteCode`, `DescribeCodeTools`, `ReadCodeDocs`), and only those
    /// can be called in it.
    fn tool_definitions_for(&self, mode: ToolMode) -> Vec<Tool> {
        match (mode, &self.code_mode) {
            (ToolMode::Code, Some(code_mode)) => definitions(&code_mode.tools).collect(),
            _ => self.tool_definitions(),
        }
    }

    /// The mode for one request: code mode wherever this deployment can run
    /// code, except for ChatGPT, whose plugin directory refuses generic
    /// executors.
    fn tool_mode(&self, extensions: &rmcp::model::Extensions) -> ToolMode {
        if self.code_mode.is_none()
            || caller(extensions).is_ok_and(|caller| may_be_chatgpt(&caller))
        {
            ToolMode::Standard
        } else {
            ToolMode::Code
        }
    }

    /// The server instructions for a mode, the same for every handshake
    /// (`initialize`, `server/discover`). They name only the tools
    /// `tool_definitions_for` lists in that mode.
    fn instructions(&self, mode: ToolMode) -> String {
        let base_url = self.item_base_url.trim_end_matches('/');
        let surface = match (mode, &self.code_mode) {
            (ToolMode::Code, Some(_)) => include_str!("code_mode_instructions.md"),
            _ => include_str!("direct_tools_instructions.md"),
        };
        format!("{}\n\n{}", surface.trim(), mcp_instructions(base_url))
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

/// The caller the bearer middleware authenticated the request as. Every
/// authenticated request carries one; there is no default to fall back to.
/// Nothing the request says for itself (headers, arguments) can name a bot.
fn caller(extensions: &rmcp::model::Extensions) -> Result<ToolCaller, rmcp::ErrorData> {
    extensions
        .get::<http::request::Parts>()
        .and_then(|parts| parts.extensions.get::<ToolCaller>().cloned())
        .ok_or_else(|| {
            rmcp::ErrorData::internal_error("missing tool caller — is auth configured?", None)
        })
}

/// Tools ChatGPT is never offered. Each one runs code or hands an open-ended
/// task to an agent, and the plugin directory refuses generic executors.
const HIDDEN_FROM_CHATGPT: [&str; 5] = [
    "BashCodeExecution",
    "CreateAgentSession",
    "DispatchCodingAgent",
    "ManageAgentSession",
    "TextEditorCodeExecution",
];

/// Whether an OAuth caller might be ChatGPT: registered under its name, or
/// holding a token with no recorded client, which gets ChatGPT's surface until
/// the next refresh records one. The name is self-reported, which is fine here:
/// this picks how tools are presented and grants nothing. A client naming
/// itself ChatGPT trades code mode for the direct native tools, which reach
/// the same data the SDK does, and loses the tools above.
fn may_be_chatgpt(caller: &ToolCaller) -> bool {
    match caller {
        ToolCaller::McpClient { name: None } => true,
        ToolCaller::McpClient { name: Some(name) } => name.eq_ignore_ascii_case("chatgpt"),
        ToolCaller::Agent(_) | ToolCaller::ApiKey => false,
    }
}

#[cfg(test)]
mod test;

/// The server instructions' shared rules, and how the areas MCP clients write
/// into work, from the SDK's `@agent` guidance.
fn mcp_instructions(base_url: &str) -> String {
    format!(
        "{}{}",
        prompt::mcp_instructions(base_url),
        agent_code_mode::domain::mcp_guides()
    )
}

impl<Context> ServerHandler for AuthenticatedToolService<Context>
where
    Context: Clone + Send + Sync + MarkdownImageResolver + CalledBy + 'static,
{
    fn get_info(&self) -> ServerConfig {
        let mut info = ServerConfig::new(ServerCapabilities::builder().enable_tools().build());
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
        // The direct tools' text. What a caller is told comes from
        // `instructions`, in `initialize` and `discover`, by the caller's mode.
        info.instructions = Some(self.instructions(ToolMode::Standard));
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
        info.instructions = Some(self.instructions(self.tool_mode(&context.extensions)));
        Ok(info)
    }

    /// The protocol revisions this server answers. Capped, so an rmcp upgrade
    /// cannot opt it into a revision whose lifecycle it has not been tested
    /// against.
    fn supported_protocol_versions(&self) -> Cow<'static, [ProtocolVersion]> {
        Cow::Borrowed(ProtocolVersion::known_up_to(&NEWEST_PROTOCOL_VERSION))
    }

    /// The 2026-07-28 lifecycle's handshake, which clients send instead of
    /// `initialize`. rmcp's default answers it from `get_info`, which would
    /// describe the direct tools to a client listed only the code-mode ones.
    async fn discover(
        &self,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<DiscoverResult, rmcp::ErrorData> {
        Self::authenticated_user_id(&context.extensions)?;
        let mut info = self.get_info();
        info.instructions = Some(self.instructions(self.tool_mode(&context.extensions)));
        let mut result =
            DiscoverResult::from_server_info(self.supported_protocol_versions().into_owned(), info);
        // The instructions depend on who is asking.
        result.cache_scope = CacheScope::Private;
        Ok(result)
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<ListToolsResult, rmcp::ErrorData> {
        Self::authenticated_user_id(&context.extensions)?;
        let mode = self.tool_mode(&context.extensions);
        let mut tools = self.tool_definitions_for(mode);
        if caller(&context.extensions).is_ok_and(|caller| may_be_chatgpt(&caller)) {
            tools.retain(|tool| !HIDDEN_FROM_CHATGPT.contains(&tool.name.as_ref()));
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
    ) -> Result<rmcp::model::CallToolResponse, rmcp::ErrorData> {
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
        result.map(Into::into)
    }
}

impl<Context> AuthenticatedToolService<Context>
where
    Context: Clone + Send + Sync + MarkdownImageResolver + CalledBy + 'static,
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
        let caller = match caller(&context.extensions) {
            Ok(caller) => caller,
            Err(error) => return (ToolCallOutcome::InvalidRequest, Err(error)),
        };

        if may_be_chatgpt(&caller) && HIDDEN_FROM_CHATGPT.contains(&request.name.as_ref()) {
            return (
                ToolCallOutcome::InvalidRequest,
                Err(rmcp::ErrorData::resource_not_found(
                    format!("tool {} not found", request.name),
                    None,
                )),
            );
        }

        let mode = self.tool_mode(&context.extensions);
        if mode == ToolMode::Code
            && !self
                .code_mode
                .as_ref()
                .is_some_and(|code_mode| code_mode.tools.tools.contains_key(request.name.as_ref()))
        {
            return (
                ToolCallOutcome::InvalidRequest,
                Err(rmcp::ErrorData::resource_not_found(
                    format!(
                        "tool {} is not available in code mode: call ExecuteCode with the SDK \
                         instead (DescribeCodeTools lists what it can do)",
                        request.name
                    ),
                    None,
                )),
            );
        }

        let Some(arguments) = request.arguments.map(serde_json::Value::Object) else {
            return (
                ToolCallOutcome::InvalidRequest,
                Err(rmcp::ErrorData::invalid_params("No params provided", None)),
            );
        };

        if let Some(code_mode) = &self.code_mode
            && code_mode.tools.tools.contains_key(request.name.as_ref())
        {
            if mode != ToolMode::Code {
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
                    UserCodeModeToolContext {
                        session: context.extensions.get::<http::request::Parts>()
                            .and_then(|parts| parts.extensions.get::<mcp_auth_proxy::inbound::middleware::ManagedAgentSession>())
                            .map(|session| session.0),
                        service: code_mode.service.clone(),
                        cognition: code_mode.cognition.clone(),
                        caller,
                    },
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
                    Ok(CallToolResult::error(vec![ContentBlock::text(
                        error.description,
                    )])),
                ),
            };
        }

        let result = match self
            .toolset
            .try_tool_call(
                self.context.clone().called_by(&caller).await,
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
                Ok(rmcp::model::CallToolResult::error(vec![
                    ContentBlock::text(error.description),
                ])),
            ),
        }
    }
}
