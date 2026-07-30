//! HTTP API: agent CRUD and posting ACP messages to a session.

use crate::domain::models::{AgentProxyErr, CreateAgentArgs, GetAgentResponse, PatchAgentArgs};
use crate::domain::service::AgentProxyService;
use agent_client_protocol::RawJsonRpcMessage;
use axum::extract::{FromRef, Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use chat::domain::models::ChatAgentKind;
use macro_authorization::{
    ActingUser, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
};
use macro_uuid::Uuid;
use model::response::{EmptyResponse, StringIDResponse};
use serde::Deserialize;
use std::sync::Arc;
use utoipa::ToSchema;

/// Shared state for the agent proxy router.
pub struct AgentProxyRouterState<S, Auth> {
    /// The agent proxy domain service.
    pub service: Arc<S>,
    /// Authorization state used by the [`MacroAuthorizationExtractor`].
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> Clone for AgentProxyRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Auth> FromRef<AgentProxyRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &AgentProxyRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the agent proxy router.
pub fn agent_proxy_router<S, Auth, St>(state: AgentProxyRouterState<S, Auth>) -> Router<St>
where
    S: AgentProxyService,
    Auth: MacroAuthorizationService,
    St: Send + Sync,
{
    Router::new()
        .route("/agents", post(create_agent::<S, Auth>))
        .route(
            "/agents/{agent_id}",
            get(get_agent::<S, Auth>)
                .patch(patch_agent::<S, Auth>)
                .delete(delete_agent::<S, Auth>),
        )
        .route(
            "/agents/{agent_id}/permanent",
            axum::routing::delete(permanently_delete_agent::<S, Auth>),
        )
        .route("/sessions/{session_id}/acp", post(post_acp::<S, Auth>))
        .with_state(state)
}

/// Health check handler.
#[utoipa::path(
    get,
    path = "/health",
    tag = "agent proxy",
    operation_id = "agent_proxy_health",
    responses((status = 200, description = "health", body = EmptyResponse))
)]
pub async fn health() -> impl IntoResponse {
    Json(EmptyResponse::default())
}

/// Request body for creating an agent.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentRequest {
    /// Optional name for the agent.
    pub name: Option<String>,
    /// Optional project to associate the agent with.
    pub project_id: Option<String>,
    /// What kind of agent to create. Defaults to `Macro`.
    #[serde(default)]
    pub kind: Option<ChatAgentKind>,
}

/// Request body for patching an agent.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PatchAgentRequest {
    /// New name for the agent, if changing.
    pub name: Option<String>,
    /// New project ID for the agent, if moving.
    pub project_id: Option<String>,
}

#[utoipa::path(
    post,
    path = "/agents",
    tag = "agent proxy",
    operation_id = "create_agent",
    request_body = CreateAgentRequest,
    responses(
        (status = 200, body = StringIDResponse),
        (status = 401, body = String),
        (status = 500, body = String),
    )
)]
/// Create a new agent.
#[tracing::instrument(skip(state, user, req), fields(user_id = %user.authorization.user.macro_user_id), err(Debug))]
pub async fn create_agent<S: AgentProxyService, Auth: MacroAuthorizationService>(
    State(state): State<AgentProxyRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, ActingUser>,
    Json(req): Json<CreateAgentRequest>,
) -> Result<Json<StringIDResponse>, AgentProxyApiError> {
    let id = state
        .service
        .create_agent(
            user.authorization.user.macro_user_id,
            CreateAgentArgs {
                name: req.name.unwrap_or_else(|| "New Agent".to_string()),
                project_id: req.project_id,
                kind: req.kind.unwrap_or_default(),
            },
        )
        .await?;

    Ok(Json(StringIDResponse { id: id.to_string() }))
}

#[utoipa::path(
    get,
    path = "/agents/{agent_id}",
    tag = "agent proxy",
    operation_id = "get_agent",
    params(("agent_id" = Uuid, Path, description = "ID of the agent")),
    responses(
        (status = 200, body = GetAgentResponse),
        (status = 401, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]

/// Get an agent with its full chat data.
#[tracing::instrument(skip(state, user), fields(user_id = %user.authorization.user.macro_user_id), err(Debug))]
pub async fn get_agent<S: AgentProxyService, Auth: MacroAuthorizationService>(
    State(state): State<AgentProxyRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, ActingUser>,
    Path(agent_id): Path<Uuid>,
) -> Result<Json<GetAgentResponse>, AgentProxyApiError> {
    let response = state
        .service
        .get_agent(user.authorization.user.macro_user_id, agent_id)
        .await?;
    Ok(Json(response))
}

#[utoipa::path(
    patch,
    path = "/agents/{agent_id}",
    tag = "agent proxy",
    operation_id = "patch_agent",
    params(("agent_id" = Uuid, Path, description = "ID of the agent")),
    request_body = PatchAgentRequest,
    responses(
        (status = 200, body = EmptyResponse),
        (status = 401, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
/// Patch an agent's metadata.
#[tracing::instrument(skip(state, user, req), fields(user_id = %user.authorization.user.macro_user_id), err(Debug))]
pub async fn patch_agent<S: AgentProxyService, Auth: MacroAuthorizationService>(
    State(state): State<AgentProxyRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, ActingUser>,
    Path(agent_id): Path<Uuid>,
    Json(req): Json<PatchAgentRequest>,
) -> Result<Json<EmptyResponse>, AgentProxyApiError> {
    state
        .service
        .patch_agent(
            user.authorization.user.macro_user_id,
            agent_id,
            PatchAgentArgs {
                name: req.name,
                project_id: req.project_id,
            },
        )
        .await?;

    Ok(Json(EmptyResponse::default()))
}

#[utoipa::path(
    delete,
    path = "/agents/{agent_id}",
    tag = "agent proxy",
    operation_id = "delete_agent",
    params(("agent_id" = Uuid, Path, description = "ID of the agent")),
    responses(
        (status = 200, body = EmptyResponse),
        (status = 401, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
/// Soft-delete an agent.
#[tracing::instrument(skip(state, user), fields(user_id = %user.authorization.user.macro_user_id), err(Debug))]
pub async fn delete_agent<S: AgentProxyService, Auth: MacroAuthorizationService>(
    State(state): State<AgentProxyRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, ActingUser>,
    Path(agent_id): Path<Uuid>,
) -> Result<Json<EmptyResponse>, AgentProxyApiError> {
    state
        .service
        .delete_agent(user.authorization.user.macro_user_id, agent_id)
        .await?;
    Ok(Json(EmptyResponse::default()))
}

#[utoipa::path(
    delete,
    path = "/agents/{agent_id}/permanent",
    tag = "agent proxy",
    operation_id = "permanently_delete_agent",
    params(("agent_id" = Uuid, Path, description = "ID of the agent")),
    responses(
        (status = 200, body = EmptyResponse),
        (status = 401, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
/// Permanently delete an agent.
#[tracing::instrument(skip(state, user), fields(user_id = %user.authorization.user.macro_user_id), err(Debug))]
pub async fn permanently_delete_agent<S: AgentProxyService, Auth: MacroAuthorizationService>(
    State(state): State<AgentProxyRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, ActingUser>,
    Path(agent_id): Path<Uuid>,
) -> Result<Json<EmptyResponse>, AgentProxyApiError> {
    state
        .service
        .permanently_delete_agent(user.authorization.user.macro_user_id, agent_id)
        .await?;
    Ok(Json(EmptyResponse::default()))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/acp",
    tag = "agent proxy",
    operation_id = "post_acp_message",
    params(("session_id" = Uuid, Path, description = "ID of the agent session (chat) to post to")),
    responses(
        (status = 202, description = "message accepted and forwarded"),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 404, body = String),
        (status = 409, description = "session has no live runtime connection", body = String),
        (status = 500, body = String),
    )
)]
/// Post one ACP JSON-RPC message to an agent session. The body is a complete
/// ACP JSON-RPC message (request, notification, or response); replies from
/// the agent stream back through the connection gateway.
#[tracing::instrument(skip(state, user, message), fields(user_id = %user.authorization.user.macro_user_id), err(Debug))]
pub async fn post_acp<S: AgentProxyService, Auth: MacroAuthorizationService>(
    State(state): State<AgentProxyRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, ActingUser>,
    Path(session_id): Path<Uuid>,
    Json(message): Json<serde_json::Value>,
) -> Result<StatusCode, AgentProxyApiError> {
    let message: RawJsonRpcMessage = serde_json::from_value(message)
        .map_err(|e| AgentProxyErr::BadRequest(format!("invalid ACP JSON-RPC message: {e}")))?;

    state
        .service
        .post_acp(user.authorization.user.macro_user_id, session_id, message)
        .await?;

    Ok(StatusCode::ACCEPTED)
}

/// HTTP error wrapper mapping [`AgentProxyErr`] to response status codes.
#[derive(Debug)]
pub struct AgentProxyApiError(AgentProxyErr);

impl From<AgentProxyErr> for AgentProxyApiError {
    fn from(err: AgentProxyErr) -> Self {
        Self(err)
    }
}

impl IntoResponse for AgentProxyApiError {
    fn into_response(self) -> axum::response::Response {
        let (status, message) = match &self.0 {
            AgentProxyErr::NotFound => (StatusCode::NOT_FOUND, "Not found"),
            AgentProxyErr::Unauthorized => (StatusCode::FORBIDDEN, "Forbidden"),
            AgentProxyErr::BadRequest(_) => (StatusCode::BAD_REQUEST, "Bad request"),
            AgentProxyErr::SessionNotConnected => {
                (StatusCode::CONFLICT, "Session is not connected")
            }
            AgentProxyErr::AcpSessionNotReady => (
                StatusCode::CONFLICT,
                "Agent runtime's ACP session is not ready yet",
            ),
            AgentProxyErr::Unknown(_) => {
                tracing::error!(error=?self.0, "agent proxy handler error");
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error")
            }
        };
        (status, message.to_string()).into_response()
    }
}
