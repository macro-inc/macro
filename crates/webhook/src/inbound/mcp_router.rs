//! Internal HTTP surface of MCP Events webhook subscriptions.
//!
//! The MCP server calls these for the user an agent acts for: it compiles
//! the filter and encrypts the secret, and this service verifies the
//! endpoint, stores the subscription and delivers to it. Users never call
//! them directly.

#[cfg(test)]
#[path = "mcp_router_test.rs"]
mod test;

use crate::domain::mcp::{
    models::{
        McpSubscribeRequest, McpSubscribeResult, McpSubscriptionErrorBody, McpUnsubscribeRequest,
    },
    ports::{McpEventSubscriptionService, McpSubscriptionError},
};
use axum::{
    Json, Router,
    extract::{FromRef, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{post, put},
};
use macro_authorization::{
    InternalOnly, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
};
use macro_user_id::user_id::MacroUserIdStr;

/// Path of subscribe; also the base of unsubscribe.
pub const MCP_EVENT_SUBSCRIPTIONS_PATH: &str = "/mcp/event_subscriptions";
/// Path of unsubscribe.
pub const MCP_EVENT_UNSUBSCRIBE_PATH: &str = "/mcp/event_subscriptions/unsubscribe";

/// State of the internal MCP subscription router.
pub struct McpSubscriptionRouterState<S, Auth> {
    service: S,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S: Clone, Auth> Clone for McpSubscriptionRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Auth> McpSubscriptionRouterState<S, Auth> {
    /// Create the router state.
    pub fn new(service: S, authorization_state: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service,
            authorization_state,
        }
    }
}

impl<S, Auth> FromRef<McpSubscriptionRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &McpSubscriptionRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Internal routes for MCP Events webhook subscriptions, to nest under an
/// internal prefix. Each needs the internal key and the acting user.
pub fn mcp_subscription_router<S, Auth, T>(state: McpSubscriptionRouterState<S, Auth>) -> Router<T>
where
    S: McpEventSubscriptionService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route(MCP_EVENT_SUBSCRIPTIONS_PATH, put(subscribe::<S, Auth>))
        .route(MCP_EVENT_UNSUBSCRIBE_PATH, post(unsubscribe::<S, Auth>))
        .with_state(state)
}

/// A failed internal subscription call.
#[derive(Debug)]
pub struct McpRouterError {
    status: StatusCode,
    body: McpSubscriptionErrorBody,
}

impl McpRouterError {
    fn no_acting_user() -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            body: McpSubscriptionErrorBody::InvalidParams {
                message: "an acting user is required".to_owned(),
            },
        }
    }
}

impl std::fmt::Display for McpRouterError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {:?}", self.status, self.body)
    }
}

impl From<McpSubscriptionError> for McpRouterError {
    fn from(error: McpSubscriptionError) -> Self {
        let (status, body) = match error {
            McpSubscriptionError::InvalidParams(message) => (
                StatusCode::BAD_REQUEST,
                McpSubscriptionErrorBody::InvalidParams { message },
            ),
            McpSubscriptionError::NotFound => {
                (StatusCode::NOT_FOUND, McpSubscriptionErrorBody::NotFound)
            }
            McpSubscriptionError::ResourceExhausted { max } => (
                StatusCode::TOO_MANY_REQUESTS,
                McpSubscriptionErrorBody::ResourceExhausted { max },
            ),
            McpSubscriptionError::CallbackEndpoint(reason) => (
                StatusCode::BAD_GATEWAY,
                McpSubscriptionErrorBody::CallbackEndpointError { reason },
            ),
            McpSubscriptionError::Internal(report) => {
                tracing::error!(error = ?report, "mcp subscription call failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    McpSubscriptionErrorBody::Internal,
                )
            }
        };
        Self { status, body }
    }
}

impl IntoResponse for McpRouterError {
    fn into_response(self) -> Response {
        (self.status, Json(self.body)).into_response()
    }
}

fn acting_user<Auth: MacroAuthorizationService>(
    authorization: MacroAuthorizationExtractor<Auth, InternalOnly>,
) -> Result<MacroUserIdStr<'static>, McpRouterError> {
    authorization
        .authorization
        .acting_user
        .map(|user| user.macro_user_id)
        .ok_or_else(McpRouterError::no_acting_user)
}

#[tracing::instrument(name = "mcp_events.subscribe_call", skip_all, err(Display))]
async fn subscribe<S, Auth>(
    authorization: MacroAuthorizationExtractor<Auth, InternalOnly>,
    State(state): State<McpSubscriptionRouterState<S, Auth>>,
    Json(request): Json<McpSubscribeRequest>,
) -> Result<Json<McpSubscribeResult>, McpRouterError>
where
    S: McpEventSubscriptionService,
    Auth: MacroAuthorizationService,
{
    let user_id = acting_user(authorization)?;
    Ok(Json(state.service.subscribe(user_id, request).await?))
}

#[tracing::instrument(name = "mcp_events.unsubscribe_call", skip_all, err(Display))]
async fn unsubscribe<S, Auth>(
    authorization: MacroAuthorizationExtractor<Auth, InternalOnly>,
    State(state): State<McpSubscriptionRouterState<S, Auth>>,
    Json(request): Json<McpUnsubscribeRequest>,
) -> Result<StatusCode, McpRouterError>
where
    S: McpEventSubscriptionService,
    Auth: MacroAuthorizationService,
{
    let user_id = acting_user(authorization)?;
    state.service.unsubscribe(request.into_key(user_id)).await?;
    Ok(StatusCode::NO_CONTENT)
}
