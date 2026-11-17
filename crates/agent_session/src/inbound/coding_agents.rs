//! Coding agent endpoints; discovery and dispatch policy live in the domain.

use std::{sync::Arc, time::Duration};

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, FromRef, Request, State, rejection::JsonRejection},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use macro_authorization::{
    InternalOnly, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
    UserOnly, UserOrInternal,
};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::domain::coding_agents::{
    CodingAgent, CodingAgentError, CodingAgentService, DispatchCodingAgentRequest,
    DispatchedCodingAgent,
};
use crate::domain::updates::AgentUpdates;

const DISPATCH_TIMEOUT: Duration = Duration::from_secs(120);
const LIST_TIMEOUT: Duration = Duration::from_secs(10);
const UPDATES_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_COMMAND_BYTES: usize = 1024 * 1024;

/// Independent state for the internal coding agent capability.
pub struct CodingAgentsState<Service, Auth> {
    service: Arc<Service>,
    authorization: MacroAuthorizationState<Auth>,
}

impl<Service, Auth> CodingAgentsState<Service, Auth> {
    /// Compose the domain capability with shared internal authentication.
    pub fn new(service: Arc<Service>, authorization: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service,
            authorization,
        }
    }
}

impl<Service, Auth> Clone for CodingAgentsState<Service, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization: self.authorization.clone(),
        }
    }
}

impl<Service, Auth> FromRef<CodingAgentsState<Service, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &CodingAgentsState<Service, Auth>) -> Self {
        state.authorization.clone()
    }
}

/// Mount credential-protected commands beneath `/internal/coding-agents`,
/// and the signed-in user's listing at `GET /coding-agents`.
pub fn coding_agents_router<Service: CodingAgentService, Auth: MacroAuthorizationService>(
    state: CodingAgentsState<Service, Auth>,
) -> Router {
    Router::new()
        .route(
            "/coding-agents",
            get(list_coding_agents_handler::<Service, Auth>),
        )
        .with_state(state.clone())
        .nest(
            "/internal/coding-agents",
            Router::new()
                .route("/list", post(list::<Service, Auth>))
                .route("/updates", get(updates::<Service, Auth>))
                .route("/dispatch", post(dispatch::<Service, Auth>))
                .route("/create-session", post(create::<Service, Auth>))
                .layer(DefaultBodyLimit::max(MAX_COMMAND_BYTES))
                .layer(middleware::from_fn(bound_request))
                .with_state(state),
        )
}

#[derive(Deserialize)]
struct ListRequest {
    user_id: MacroUserIdStr<'static>,
}

/// The coding agents the caller can start a session as right now.
#[derive(Serialize, ToSchema)]
pub struct CodingAgentsResponse {
    /// Available coding personas, built-in ones such as Cursor first.
    pub agents: Vec<CodingAgent>,
}

/// A sanitized coding agent failure with its HTTP status.
pub struct ApiError(CodingAgentError);

impl From<CodingAgentError> for ApiError {
    fn from(error: CodingAgentError) -> Self {
        Self(error)
    }
}

impl From<JsonRejection> for ApiError {
    fn from(_: JsonRejection) -> Self {
        Self(CodingAgentError::InvalidCommand)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self.0 {
            CodingAgentError::InvalidCommand | CodingAgentError::InvalidPrompt => {
                StatusCode::BAD_REQUEST
            }
            CodingAgentError::Forbidden => StatusCode::FORBIDDEN,
            CodingAgentError::Unavailable => StatusCode::NOT_FOUND,
            CodingAgentError::DispatchFailed { .. } | CodingAgentError::DispatchDeliveryUnknown => {
                StatusCode::BAD_GATEWAY
            }
            CodingAgentError::OperationFailed => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, Json(self.0)).into_response()
    }
}

async fn bound_request(request: Request, next: Next) -> Response {
    let path = request.uri().path();
    let is_dispatch = !path.ends_with("/list") && !path.ends_with("/updates");
    let timeout = if path.ends_with("/updates") {
        UPDATES_TIMEOUT
    } else if is_dispatch {
        DISPATCH_TIMEOUT
    } else {
        LIST_TIMEOUT
    };
    bounded_response(is_dispatch, timeout, next.run(request)).await
}

async fn bounded_response(
    is_dispatch: bool,
    timeout: Duration,
    response: impl Future<Output = Response>,
) -> Response {
    match tokio::time::timeout(timeout, response).await {
        Ok(response) => response,
        Err(_) => {
            // A timeout cannot undo session creation or an accepted prompt.
            let code = if is_dispatch {
                CodingAgentError::DispatchDeliveryUnknown
            } else {
                CodingAgentError::OperationFailed
            };
            (StatusCode::GATEWAY_TIMEOUT, Json(code)).into_response()
        }
    }
}

async fn list<Service: CodingAgentService, Auth: MacroAuthorizationService>(
    State(state): State<CodingAgentsState<Service, Auth>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    command: Result<Json<ListRequest>, JsonRejection>,
) -> Result<Json<CodingAgentsResponse>, ApiError> {
    Ok(Json(CodingAgentsResponse {
        agents: state.service.list(command?.0.user_id).await?,
    }))
}

/// List the coding agents the caller can start a session as: the same
/// personas the `ListCodingAgents` tool offers, including built-in ones whose
/// runtime the caller has connected (Cursor once its key is saved).
#[utoipa::path(
    get,
    path = "/coding-agents",
    tag = "coding-agents",
    operation_id = "list_coding_agents",
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "The caller's available coding agents", body = CodingAgentsResponse),
        (status = 401, description = "Unauthenticated"),
        (status = 500, description = "The personas or their runtime connections could not be read"),
    )
)]
pub async fn list_coding_agents_handler<
    Service: CodingAgentService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<CodingAgentsState<Service, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Result<Json<CodingAgentsResponse>, ApiError> {
    Ok(Json(CodingAgentsResponse {
        agents: state.service.list(user.authorization.macro_user_id).await?,
    }))
}

async fn updates<Service: CodingAgentService, Auth: MacroAuthorizationService>(
    State(state): State<CodingAgentsState<Service, Auth>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<AgentUpdates>, ApiError> {
    Ok(Json(
        state
            .service
            .list_updates(user.authorization.user.macro_user_id)
            .await?,
    ))
}

async fn dispatch<Service: CodingAgentService, Auth: MacroAuthorizationService>(
    State(state): State<CodingAgentsState<Service, Auth>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    command: Result<Json<DispatchCodingAgentRequest>, JsonRejection>,
) -> Result<Json<DispatchedCodingAgent>, ApiError> {
    Ok(Json(state.service.dispatch(command?.0).await?))
}

#[cfg(test)]
mod test;

async fn create<Service: CodingAgentService, Auth: MacroAuthorizationService>(
    State(state): State<CodingAgentsState<Service, Auth>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    command: Result<Json<DispatchCodingAgentRequest>, JsonRejection>,
) -> Result<Json<DispatchedCodingAgent>, ApiError> {
    Ok(Json(state.service.create(command?.0).await?))
}
