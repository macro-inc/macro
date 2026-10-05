//! Internal coding agent endpoints; discovery and dispatch policy live in the domain.

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
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};

use crate::domain::coding_agents::{
    CodingAgent, CodingAgentError, CodingAgentService, DispatchCodingAgentRequest,
    DispatchedCodingAgent,
};

const DISPATCH_TIMEOUT: Duration = Duration::from_secs(120);
const LIST_TIMEOUT: Duration = Duration::from_secs(10);
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

/// Mount credential-protected commands beneath `/internal/coding-agents`.
pub fn coding_agents_router<Service: CodingAgentService, Auth: MacroAuthorizationService>(
    state: CodingAgentsState<Service, Auth>,
) -> Router {
    Router::new().nest(
        "/internal/coding-agents",
        Router::new()
            .route("/list", post(list::<Service, Auth>))
            .route("/dispatch", post(dispatch::<Service, Auth>))
            .layer(DefaultBodyLimit::max(MAX_COMMAND_BYTES))
            .layer(middleware::from_fn(bound_request))
            .with_state(state),
    )
}

#[derive(Deserialize)]
struct ListRequest {
    user_id: MacroUserIdStr<'static>,
}

#[derive(Serialize)]
struct ListResponse {
    agents: Vec<CodingAgent>,
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
    let is_dispatch = request.uri().path().ends_with("/dispatch");
    let timeout = if is_dispatch {
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
) -> Result<Json<ListResponse>, ApiError> {
    Ok(Json(ListResponse {
        agents: state.service.list(command?.0.user_id).await?,
    }))
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
