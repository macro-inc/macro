//! Thin transport adapter linking a session to the Macro task it works on.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::put,
};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{ActingUser, MacroAuthorizationExtractor, MacroAuthorizationService};
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{AgentSessionApiError, AgentSessionRouterState};
use crate::domain::{
    model::AgentSessionId,
    session_task::{SessionTaskError, SessionTasks},
};

/// Task routes, mounted below `/agent-sessions`.
pub fn agent_session_task_router<Access, Auth, S>(
    state: AgentSessionRouterState<Arc<dyn SessionTasks>, Access, Auth>,
) -> Router<S>
where
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/{session_id}/task",
            put(link_agent_session_task::<Access, Auth>),
        )
        .with_state(state)
}

/// The task to link a session to.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LinkTaskRequest {
    /// The task document's id.
    pub task_id: Uuid,
}

/// The task a session is now linked to.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LinkedTaskResponse {
    /// The task document's id.
    pub task_id: String,
    /// Put this in the pull request description so GitHub activity reaches the task.
    pub reference: String,
    /// The session's pull request, now linked to the task, if it has one.
    pub pull_request_url: Option<String>,
}

#[utoipa::path(
    put,
    path = "/agent-sessions/{session_id}/task",
    tag = "agent-sessions",
    operation_id = "link_agent_session_task",
    params(("session_id" = Uuid, Path, description = "ID of the agent session")),
    request_body = LinkTaskRequest,
    responses(
        (status = 200, body = LinkedTaskResponse),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
/// Link a session the caller owns to a task they can view, replacing any earlier link. The
/// session's pull request, now or later, is linked to the task.
#[tracing::instrument(skip_all, err(Debug))]
pub async fn link_agent_session_task<
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<AgentSessionRouterState<Arc<dyn SessionTasks>, Access, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, ActingUser>,
    Path(session_id): Path<Uuid>,
    Json(request): Json<LinkTaskRequest>,
) -> Result<Json<LinkedTaskResponse>, SessionTaskApiError> {
    let linked = state
        .service
        .link_task(
            AgentSessionId::new_from_uuid(session_id),
            &caller.authorization.user.macro_user_id,
            &request.task_id.to_string(),
        )
        .await?;
    Ok(Json(LinkedTaskResponse {
        task_id: linked.task_id,
        reference: linked.reference,
        pull_request_url: linked.pull_request,
    }))
}

/// Transport error for task links.
#[derive(Debug)]
pub struct SessionTaskApiError(SessionTaskError);

impl From<SessionTaskError> for SessionTaskApiError {
    fn from(error: SessionTaskError) -> Self {
        Self(error)
    }
}

impl IntoResponse for SessionTaskApiError {
    fn into_response(self) -> Response {
        match self.0 {
            SessionTaskError::InvalidTaskReference | SessionTaskError::NotATask => {
                (StatusCode::BAD_REQUEST, self.0.to_string()).into_response()
            }
            SessionTaskError::TaskNotFound => {
                (StatusCode::NOT_FOUND, self.0.to_string()).into_response()
            }
            SessionTaskError::Session(error) => AgentSessionApiError::from(error).into_response(),
            SessionTaskError::Unavailable(report) => {
                tracing::error!(%report, "could not link the session's task");
                (StatusCode::INTERNAL_SERVER_ERROR, "could not link the task").into_response()
            }
        }
    }
}
