//! Macro Internal MCP: session tools served by the harness, separate from workspace MCP.

use agent_code_mode::{domain::SessionCodeMode, inbound::toolset::CodeModeToolContext};
use agent_code_mode::{domain::reviews::ReviewService, inbound::reviews::ReviewToolContext};
use std::sync::{Arc, OnceLock};

use agent_session::domain::ports::AgentSessionRepo;
use agent_session::{
    domain::{pull_request::SessionPullRequests, session_task::SessionTasks},
    inbound::toolset::{LinkTask, SessionToolContext, SetPullRequest, TaskPullRequestsTool},
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
    AsyncToolCollection::new()
        .add_tool::<SetPullRequest, SessionToolContext>()
        .add_tool::<LinkTask, SessionToolContext>()
        .add_tool::<TaskPullRequestsTool, SessionToolContext>()
}

/// Build the internal endpoint with per-request session authentication.
pub fn router<A: AgentSessionRepo + 'static>(
    authority: Arc<A>,
    service: Arc<dyn SessionPullRequests>,
    tasks: Arc<dyn SessionTasks>,
    host: String,
    code_mode: Option<Arc<dyn SessionCodeMode>>,
    reviews: Arc<OnceLock<ReviewService>>,
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
                tasks: tasks.clone(),
                code_mode: code_mode.clone(),
                reviews: reviews.clone(),
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
    tasks: Arc<dyn SessionTasks>,
    code_mode: Option<Arc<dyn SessionCodeMode>>,
    reviews: Arc<OnceLock<ReviewService>>,
}

impl ServerHandler for InternalTools {
    fn get_info(&self) -> ServerInfo {
        let mut info = ServerInfo::new(ServerCapabilities::builder().enable_tools().build());
        info.server_info = rmcp::model::Implementation::new(
            agent_harness::domain::model::INTERNAL_MCP_NAME,
            env!("CARGO_PKG_VERSION"),
        )
        .with_title("Macro Internal MCP");
        info.instructions = Some(prompt::pull_requests::internal_mcp_instructions());
        info.instructions.as_mut().expect("instructions are set").push_str(
            " macro_internal.PresentReview presents editable email/calendar draft stacks or questions through the shared session stream. It completes immediately as Presented to the user and never waits for approval. Later user decisions append recorded outcomes to the session. It is available even when code mode is disabled.",
        );
        if self.code_mode.is_some() {
            info.instructions.as_mut().expect("instructions are set").push_str(
                " macro_internal.ExecuteCode and macro_internal.DescribeCodeTools are available directly, without tool search. Follow their descriptions for the JavaScript main module, real SDK entity documentation, and persistent review workflow. Reuse entity documentation already expanded in context.",
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
        definitions.extend(
            agent_code_mode::inbound::reviews::toolset()
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
                            .read_only(false)
                            .destructive(false)
                            .idempotent(false)
                            .open_world(false),
                    )
                }),
        );
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
        let review_tools = agent_code_mode::inbound::reviews::toolset();
        if review_tools.tools.contains_key(request.name.as_ref()) {
            let service = self.reviews.get().ok_or_else(|| {
                rmcp::ErrorData::internal_error("Review service is unavailable", None)
            })?;
            let result = review_tools
                .try_tool_call(
                    ReviewToolContext {
                        service: service.clone(),
                        session: grant.clone(),
                    },
                    RequestContext::new(owner.clone()).with_genai_telemetry(false),
                    &request.name,
                    &serde_json::Value::Object(request.arguments.unwrap_or_default()),
                )
                .await
                .map_err(|error| rmcp::ErrorData::invalid_params(error.to_string(), None))?;
            return Ok(match result {
                Ok(value) => CallToolResult::structured(value),
                Err(error) => CallToolResult::error(vec![Content::text(error.description)]),
            });
        }
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
                    tasks: self.tasks.clone(),
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
