//! Telling a session its owner connected an app, mounted under
//! `/agent-sessions`.
//!
//! The browser reports the connection; the harness checks it and produces the
//! `app.connected` event that continues the session, so the caller can
//! neither choose the words nor slip anything else into someone's session.

use std::sync::Arc;

use agent_runtime_protocol::domain::action::AgentActionId;
use agent_session::domain::model::AgentSessionId;
use agent_session::inbound::axum_router::AgentSessionApiError;
use axum::Router;
use axum::extract::{FromRef, Json, Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use entity_access::domain::models::EditAccessLevel;
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::AgentSessionAccessLevelExtractor;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use macro_uuid::Uuid;
use serde::Deserialize;
use utoipa::ToSchema;

use crate::domain::app_connections::{
    AppConnectedContinuation, AppConnectedError, ConnectedApps, SessionNotifications,
    SessionStandings,
};

/// Request body for reporting a connected app.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AppConnectedRequest {
    /// The Pipedream app slug the owner connected, e.g. `notion`.
    pub app_slug: String,
    /// Names the report, so a retried one wakes the session once.
    pub action_id: Option<AgentActionId>,
}

/// Router state: the continuation, plus what the access extractor resolves
/// grants and identity through.
pub struct AppConnectionsRouterState<Sessions, Apps, Notifications, Access, Auth> {
    continuation: Arc<AppConnectedContinuation<Sessions, Apps, Notifications>>,
    entity_access: Arc<Access>,
    authorization: MacroAuthorizationState<Auth>,
}

impl<Sessions, Apps, Notifications, Access, Auth>
    AppConnectionsRouterState<Sessions, Apps, Notifications, Access, Auth>
{
    /// Build the state.
    pub fn new(
        continuation: Arc<AppConnectedContinuation<Sessions, Apps, Notifications>>,
        entity_access: Arc<Access>,
        authorization: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            continuation,
            entity_access,
            authorization,
        }
    }
}

impl<Sessions, Apps, Notifications, Access, Auth> Clone
    for AppConnectionsRouterState<Sessions, Apps, Notifications, Access, Auth>
{
    fn clone(&self) -> Self {
        Self {
            continuation: Arc::clone(&self.continuation),
            entity_access: Arc::clone(&self.entity_access),
            authorization: self.authorization.clone(),
        }
    }
}

impl<Sessions, Apps, Notifications, Access, Auth>
    FromRef<AppConnectionsRouterState<Sessions, Apps, Notifications, Access, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(
        state: &AppConnectionsRouterState<Sessions, Apps, Notifications, Access, Auth>,
    ) -> Self {
        state.authorization.clone()
    }
}

impl<Sessions, Apps, Notifications, Access, Auth>
    FromRef<AppConnectionsRouterState<Sessions, Apps, Notifications, Access, Auth>>
    for Arc<Access>
{
    fn from_ref(
        state: &AppConnectionsRouterState<Sessions, Apps, Notifications, Access, Auth>,
    ) -> Self {
        Arc::clone(&state.entity_access)
    }
}

/// Build the router. Mount it under `/agent-sessions`.
pub fn app_connections_router<Sessions, Apps, Notifications, Access, Auth, S>(
    state: AppConnectionsRouterState<Sessions, Apps, Notifications, Access, Auth>,
) -> Router<S>
where
    Sessions: SessionStandings,
    Apps: ConnectedApps,
    Notifications: SessionNotifications,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/{session_id}/app-connections",
            post(app_connected_handler::<Sessions, Apps, Notifications, Access, Auth>),
        )
        .with_state(state)
}

fn error_response(error: AppConnectedError) -> Response {
    match error {
        AppConnectedError::NotOwner => (StatusCode::FORBIDDEN, error.to_string()).into_response(),
        AppConnectedError::Archived => (StatusCode::CONFLICT, error.to_string()).into_response(),
        AppConnectedError::NotConnected(_) => {
            (StatusCode::UNPROCESSABLE_ENTITY, error.to_string()).into_response()
        }
        AppConnectedError::Session(error) => AgentSessionApiError::from(error).into_response(),
        AppConnectedError::Internal(error) => {
            tracing::error!(error = ?error, "continuing a session after a connection failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response()
        }
    }
}

#[utoipa::path(
    post,
    path = "/agent-sessions/{session_id}/app-connections",
    tag = "agent-sessions",
    operation_id = "report_agent_session_app_connected",
    params(("session_id" = Uuid, Path, description = "ID of the agent session")),
    request_body = AppConnectedRequest,
    responses(
        (status = 202, description = "The session continues once it is idle"),
        (status = 401, body = String),
        (status = 403, body = String, description = "Not the session's owner, or no edit access"),
        (status = 409, body = String, description = "The session is archived"),
        (status = 422, body = String, description = "The owner has not connected that app"),
        (status = 500, body = String),
    )
)]
/// Continue the session now that its owner connected an app it asked for.
///
/// The harness produces an `app.connected` system event, which the transcript
/// shows as no prompt; it starts a turn once the session is idle.
#[tracing::instrument(skip_all, fields(%session_id, app_slug = %request.app_slug), err(Debug))]
pub async fn app_connected_handler<Sessions, Apps, Notifications, Access, Auth>(
    access: AgentSessionAccessLevelExtractor<EditAccessLevel, Access, Auth>,
    State(state): State<AppConnectionsRouterState<Sessions, Apps, Notifications, Access, Auth>>,
    Path(session_id): Path<Uuid>,
    Json(request): Json<AppConnectedRequest>,
) -> Result<StatusCode, Response>
where
    Sessions: SessionStandings,
    Apps: ConnectedApps,
    Notifications: SessionNotifications,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let user = access
        .entity_access_receipt
        .get_authenticated_user()
        .map_err(|_| (StatusCode::FORBIDDEN, "a person must connect the app").into_response())?
        .clone();
    state
        .continuation
        .continue_session(
            AgentSessionId::new_from_uuid(session_id),
            &user,
            &request.app_slug,
            request.action_id,
        )
        .await
        .map_err(error_response)?;
    Ok(StatusCode::ACCEPTED)
}
