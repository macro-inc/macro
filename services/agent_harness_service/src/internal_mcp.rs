//! Macro Internal MCP: session tools served by the harness, separate from workspace MCP.

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
        info
    }

    async fn list_tools(
        &self,
        _: Option<PaginatedRequestParams>,
        _: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<ListToolsResult, rmcp::ErrorData> {
        Ok(ListToolsResult {
            tools: toolset()
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
                .collect(),
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
        let result = toolset()
            .try_tool_call(
                SessionToolContext {
                    service: self.service.clone(),
                    session: grant.id,
                },
                RequestContext::new(grant.owner_id.clone()),
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
