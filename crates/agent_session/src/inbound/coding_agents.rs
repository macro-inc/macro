//! Internal agent session creation endpoint; creation policy lives in the domain.

use std::{sync::Arc, time::Duration};

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, FromRef, Request, State, rejection::JsonRejection},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::post,
};
use macro_authorization::{
    InternalOnly, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
};

use crate::domain::coding_agents::{
    CodingAgentError, CodingAgentService, DispatchCodingAgentRequest, DispatchedCodingAgent,
};

const CREATE_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_COMMAND_BYTES: usize = 1024 * 1024;

/// Independent state for the internal session creation capability.
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

/// Mount credential-protected commands beneath `/internal/coding-agents`.
pub fn coding_agents_router<Service: CodingAgentService, Auth: MacroAuthorizationService>(
    state: CodingAgentsState<Service, Auth>,
) -> Router {
    Router::new().nest(
        "/internal/coding-agents",
        Router::new()
            .route("/create-session", post(create::<Service, Auth>))
            .layer(DefaultBodyLimit::max(MAX_COMMAND_BYTES))
            .layer(middleware::from_fn(bound_request))
            .with_state(state),
    )
}

struct ApiError(CodingAgentError);

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
    bounded_response(CREATE_TIMEOUT, next.run(request)).await
}

async fn bounded_response(timeout: Duration, response: impl Future<Output = Response>) -> Response {
    match tokio::time::timeout(timeout, response).await {
        Ok(response) => response,
        // A timeout cannot undo session creation or an accepted prompt.
        Err(_) => (
            StatusCode::GATEWAY_TIMEOUT,
            Json(CodingAgentError::DispatchDeliveryUnknown),
        )
            .into_response(),
    }
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
