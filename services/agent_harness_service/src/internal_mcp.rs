//! Macro Internal MCP: session tools served by the harness, separate from workspace MCP.

use agent_code_mode::{domain::SessionCodeMode, inbound::toolset::CodeModeToolContext};
use std::sync::Arc;

use agent_session::domain::ports::AgentSessionRepo;
use agent_session::{
    domain::pull_request::SessionPullRequests,
    inbound::toolset::{SessionToolContext, SetPullRequest},
};
use ai_toolset::{AsyncToolCollection, RequestContext, ToolSet};
use axum::{
    Router,
    extract::Request,
    middleware::{self, Next},
    response::Response,
};
use rmcp::{
    ServerHandler,
    model::{
        CallToolRequestParams, CallToolResult, Content, ListToolsResult, PaginatedRequestParams,
        ServerCapabilities, ServerInfo, Tool, ToolAnnotations,
    },
    transport::streamable_http_server::{
        StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
    },
};

mod authenticated_session;
use authenticated_session::AuthenticatedSession;

#[cfg(test)]
mod test;

fn toolset() -> AsyncToolCollection<SessionToolContext> {
    AsyncToolCollection::new().add_tool::<SetPullRequest, SessionToolContext>()
}

/// Build the internal endpoint with per-request session authentication.
pub fn router<A: AgentSessionRepo + 'static>(
    authority: Arc<A>,
    service: Arc<dyn SessionPullRequests>,
    host: String,
    code_mode: Option<Arc<dyn SessionCodeMode>>,
) -> Router {
    let mut config = StreamableHttpServerConfig::default().with_allowed_hosts([
        host,
        "localhost".into(),
        "127.0.0.1".into(),
        "gateway.macro.com".into(),
        "dev-gateway.macro.com".into(),
    ]);
    config.stateful_mode = false;
    config.json_response = true;
    let server = StreamableHttpService::new(
        move || {
            Ok(InternalTools {
                service: service.clone(),
                code_mode: code_mode.clone(),
            })
        },
        Arc::new(LocalSessionManager::default()),
        config,
    );
    Router::new()
        .nest_service("/mcp/internal", server)
        .layer(middleware::from_fn_with_state(authority, authenticate))
}

async fn authenticate(session: AuthenticatedSession, mut request: Request, next: Next) -> Response {
    request.extensions_mut().insert(session);
    next.run(request).await
}

struct InternalTools {
    service: Arc<dyn SessionPullRequests>,
    code_mode: Option<Arc<dyn SessionCodeMode>>,
}

impl ServerHandler for InternalTools {
    fn get_info(&self) -> ServerInfo {
        let mut info = ServerInfo::new(ServerCapabilities::builder().enable_tools().build());
        info.server_info = rmcp::model::Implementation::new(
            agent_harness::domain::model::INTERNAL_MCP_NAME,
            env!("CARGO_PKG_VERSION"),
        )
        .with_title("Macro Internal MCP");
        info.instructions = Some(
            "When you create or start working on a pull request, register its URL with Macro using macro_internal.set_pull_request. \
             Save any screenshot or screen recording meant for the user into your artifacts directory and refer to it in prose by file name only, never by a sandbox path: Macro re-hosts uploaded artifacts and cannot reach files anywhere else.".into(),
        );
        if self.code_mode.is_some() {
            info.instructions.as_mut().expect("instructions are set").push_str(
                " For multi-step Macro workflows, use macro_internal.DescribeCodeTools to discover SDK methods, then macro_internal.ExecuteCode to await them in TypeScript and return a compact JSON result. Inner calls retain their Macro components. Human-interactive tools and subagents remain direct tool calls.",
            );
        }
        info
    }

    async fn list_tools(
        &self,
        _: Option<PaginatedRequestParams>,
        _: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<ListToolsResult, rmcp::ErrorData> {
        let mut definitions: Vec<_> = toolset()
            .tools
            .iter()
            .map(|(name, tool)| {
                Tool::new(
                    name.clone(),
                    tool.description.clone(),
                    Arc::new(tool.input_schema.clone()),
                )
                .with_title(tool.annotations.title)
                .annotate(
                    ToolAnnotations::with_title(tool.annotations.title)
                        .read_only(tool.annotations.kind.read_only_hint())
                        .destructive(tool.annotations.kind.destructive_hint())
                        .idempotent(tool.annotations.idempotent)
                        .open_world(tool.annotations.open_world),
                )
            })
            .collect();
        if self.code_mode.is_some() {
            definitions.extend(
                agent_code_mode::inbound::toolset::toolset()
                    .tools
                    .iter()
                    .map(|(name, tool)| {
                        Tool::new(
                            name.clone(),
                            tool.description.clone(),
                            Arc::new(tool.input_schema.clone()),
                        )
                        .with_title(tool.annotations.title)
                        .annotate(
                            ToolAnnotations::with_title(tool.annotations.title)
                                .read_only(tool.annotations.kind.read_only_hint())
                                .destructive(tool.annotations.kind.destructive_hint())
                                .idempotent(tool.annotations.idempotent)
                                .open_world(tool.annotations.open_world),
                        )
                    }),
            );
        }
        Ok(ListToolsResult {
            tools: definitions,
            ..Default::default()
        })
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let AuthenticatedSession(grant) = context
            .extensions
            .get::<axum::http::request::Parts>()
            .and_then(|parts| parts.extensions.get::<AuthenticatedSession>())
            .ok_or_else(|| {
                rmcp::ErrorData::invalid_request("Missing session authorization", None)
            })?;
        // Session tools run as the owner; a session owned by anything else
        // has nobody to run them as.
        let owner = grant
            .owner_user()
            .map_err(|error| rmcp::ErrorData::invalid_request(error.to_string(), None))?;
        if let Some(code_mode) = &self.code_mode {
            let tools = agent_code_mode::inbound::toolset::toolset();
            if tools.tools.contains_key(request.name.as_ref()) {
                // The session actor meters the outer MCP call. Only SDK calls
                // bypass ACP and retain the toolset's own telemetry.
                let mut request_context =
                    RequestContext::new(owner.clone()).with_genai_telemetry(false);
                request_context.cancel = context.ct.clone();
                let result = tools
                    .try_tool_call(
                        CodeModeToolContext {
                            service: code_mode.clone(),
                            session: grant.clone(),
                        },
                        request_context,
                        &request.name,
                        &serde_json::Value::Object(request.arguments.unwrap_or_default()),
                    )
                    .await
                    .map_err(|error| rmcp::ErrorData::invalid_params(error.to_string(), None))?;
                return Ok(match result {
                    // A failed program is a completed execution with a receipt.
                    // MCP errors discard structured content in some runtimes.
                    Ok(value) => CallToolResult::structured(value),
                    Err(error) => CallToolResult::error(vec![Content::text(error.description)]),
                });
            }
        }
        let result = toolset()
            .try_tool_call(
                SessionToolContext {
                    service: self.service.clone(),
                    session: grant.id,
                },
                RequestContext::new(owner.clone()),
                &request.name,
                &serde_json::Value::Object(request.arguments.unwrap_or_default()),
            )
            .await
            .map_err(|error| match error {
                ai_toolset::ToolSetError::Deserialization(error) => {
                    rmcp::ErrorData::invalid_params(error.to_string(), None)
                }
                ai_toolset::ToolSetError::NotFound(message) => {
                    rmcp::ErrorData::resource_not_found(message, None)
                }
            })?;
        Ok(match result {
            Ok(value) => CallToolResult::success(vec![Content::text(value.to_string())]),
            Err(error) => CallToolResult::error(vec![Content::text(error.description)]),
        })
    }
}
