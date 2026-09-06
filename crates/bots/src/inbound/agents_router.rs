//! Axum router for persisted AI agents.
//!
//! Separate from [`super::axum_router`] because agents are served by the agent
//! harness service while plain bots (webhooks, tokens, channel reach) stay
//! with channels. The two routers share the domain service but not a process.

use crate::domain::{
    models::{Agent, BotId, CreateAgentRequest, UpdateAgentRequest},
    ports::BotService,
};
use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    routing::{get, post, put},
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use model_error_response::ErrorResponse;
use std::sync::Arc;

use super::axum_router::BotsHandlerErr;

/// State for the agents router.
pub struct AgentsRouterState<S, Auth> {
    service: Arc<S>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> Clone for AgentsRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S: BotService, Auth> AgentsRouterState<S, Auth> {
    /// Create a router state.
    pub fn new(service: Arc<S>, authorization_state: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service,
            authorization_state,
        }
    }
}

impl<S, Auth> FromRef<AgentsRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &AgentsRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Agent path.
#[derive(Debug, serde::Deserialize)]
pub struct AgentPath {
    /// Agent bot id.
    pub agent_id: BotId,
}

/// Create an agents router.
pub fn agents_router<S, Auth, T>(state: AgentsRouterState<S, Auth>) -> Router<T>
where
    S: BotService,
    Auth: MacroAuthorizationService,
    T: Send + Sync,
{
    Router::new()
        .route("/agents", get(list_agents_handler::<S, Auth>))
        .route("/agents", post(create_agent_handler::<S, Auth>))
        .route("/agents/{agent_id}", put(update_agent_handler::<S, Auth>))
        .with_state(state)
}

/// Handler for `POST /agents`.
#[utoipa::path(
    post,
    tag = "agents",
    operation_id = "create_agent",
    path = "/agents",
    request_body = CreateAgentRequest,
    responses(
        (status = 201, body = Agent),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn create_agent_handler<S: BotService, Auth: MacroAuthorizationService>(
    State(state): State<AgentsRouterState<S, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(req): Json<CreateAgentRequest>,
) -> Result<(StatusCode, Json<Agent>), BotsHandlerErr> {
    let agent = state
        .service
        .create_agent(authorization.authorization.user.macro_user_id, req)
        .await?;
    Ok((StatusCode::CREATED, Json(agent)))
}

/// Handler for `GET /agents`.
#[utoipa::path(
    get,
    tag = "agents",
    operation_id = "list_agents",
    path = "/agents",
    responses(
        (status = 200, body = Vec<Agent>),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn list_agents_handler<S: BotService, Auth: MacroAuthorizationService>(
    State(state): State<AgentsRouterState<S, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<Vec<Agent>>, BotsHandlerErr> {
    Ok(Json(
        state
            .service
            .list_agents(authorization.authorization.user.macro_user_id)
            .await?,
    ))
}

/// Handler for `PUT /agents/{agent_id}`.
#[utoipa::path(
    put,
    tag = "agents",
    operation_id = "update_agent",
    path = "/agents/{agent_id}",
    params(
        ("agent_id" = BotId, Path, description = "Agent bot ID")
    ),
    request_body = UpdateAgentRequest,
    responses(
        (status = 200, body = Agent),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn update_agent_handler<S: BotService, Auth: MacroAuthorizationService>(
    State(state): State<AgentsRouterState<S, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<AgentPath>,
    Json(req): Json<UpdateAgentRequest>,
) -> Result<Json<Agent>, BotsHandlerErr> {
    Ok(Json(
        state
            .service
            .update_agent(
                authorization.authorization.user.macro_user_id,
                path.agent_id,
                req,
            )
            .await?,
    ))
}
