//! Thin transport adapter for the caller's coding sessions awaiting them.

use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{ActingUser, MacroAuthorizationExtractor, MacroAuthorizationService};

use super::AgentSessionRouterState;
use crate::domain::{
    coding_agents::CodingAgentError,
    updates::{AgentUpdates, CodingAgentUpdatesRepo, list_updates},
};

/// The updates route, mounted below `/agent-sessions`.
pub fn agent_session_updates_router<T, Access, Auth, S>(
    state: AgentSessionRouterState<T, Access, Auth>,
) -> Router<S>
where
    T: CodingAgentUpdatesRepo,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/updates",
            get(list_agent_session_updates::<T, Access, Auth>),
        )
        .with_state(state)
}

#[utoipa::path(
    get,
    path = "/agent-sessions/updates",
    tag = "agent-sessions",
    operation_id = "list_agent_session_updates",
    responses(
        (status = 200, body = AgentUpdates),
        (status = 401, body = String),
        (status = 500, body = String),
    )
)]
/// The caller's coding sessions waiting for their answer, or stalled for over 20 minutes,
/// newest activity first.
#[tracing::instrument(skip_all, err(Debug))]
pub async fn list_agent_session_updates<
    T: CodingAgentUpdatesRepo,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<AgentSessionRouterState<T, Access, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, ActingUser>,
) -> Result<Json<AgentUpdates>, UpdatesApiError> {
    Ok(Json(
        list_updates(
            state.service.as_ref(),
            caller.authorization.user.macro_user_id,
        )
        .await?,
    ))
}

/// Transport error for updates.
#[derive(Debug)]
pub struct UpdatesApiError(CodingAgentError);

impl From<CodingAgentError> for UpdatesApiError {
    fn from(error: CodingAgentError) -> Self {
        Self(error)
    }
}

impl IntoResponse for UpdatesApiError {
    fn into_response(self) -> Response {
        (StatusCode::INTERNAL_SERVER_ERROR, self.0.to_string()).into_response()
    }
}
