//! Thin transport adapters for pausing a session's thread replies.

use axum::{Json, Router, extract::State, routing::get};
use entity_access::{
    domain::{
        models::{EditAccessLevel, ViewAccessLevel},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::AgentSessionAccessLevelExtractor,
};
use macro_authorization::MacroAuthorizationService;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{AgentSessionApiError, AgentSessionRouterState};
use crate::domain::thread_replies::ThreadReplies;

/// The per-session thread-reply routes. Mount at the root.
pub fn agent_thread_replies_router<T, Access, Auth, S>(
    state: AgentSessionRouterState<T, Access, Auth>,
) -> Router<S>
where
    T: ThreadReplies,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/agent-sessions/{session_id}/thread-replies",
            get(get_session_thread_replies::<T, Access, Auth>)
                .put(put_session_thread_replies::<T, Access, Auth>),
        )
        .with_state(state)
}

/// Whether a session answers unmentioned replies in the thread it was started from.
#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionThreadRepliesResponse {
    /// The session was started from a thread. Only such a session answers replies there, so
    /// only it can be paused.
    pub from_thread: bool,
    /// The agent answers only messages that mention it.
    pub paused: bool,
    /// The caller may pause or resume it: edit access to the session.
    pub can_change: bool,
}

/// Pause or resume a session's unmentioned thread replies.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetSessionThreadRepliesRequest {
    /// Answer only messages that mention the agent, or resume answering replies.
    pub paused: bool,
}

#[utoipa::path(
    get,
    path = "/agent-sessions/{session_id}/thread-replies",
    tag = "agent-sessions",
    operation_id = "get_agent_session_thread_replies",
    params(("session_id" = uuid::Uuid, Path, description = "ID of the agent session")),
    responses(
        (status = 200, body = SessionThreadRepliesResponse),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
/// Read whether a session answers unmentioned replies in its thread.
#[tracing::instrument(skip_all, err(Debug))]
pub async fn get_session_thread_replies<
    T: ThreadReplies,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: AgentSessionAccessLevelExtractor<ViewAccessLevel, Access, Auth>,
    State(state): State<AgentSessionRouterState<T, Access, Auth>>,
) -> Result<Json<SessionThreadRepliesResponse>, AgentSessionApiError> {
    let replies = state
        .service
        .thread_replies(&access.entity_access_receipt)
        .await?;
    let can_change = access
        .entity_access_receipt
        .entity_permission()
        .satisfies::<EditAccessLevel>();
    Ok(Json(SessionThreadRepliesResponse {
        from_thread: replies.from_thread,
        paused: replies.paused,
        can_change,
    }))
}

#[utoipa::path(
    put,
    path = "/agent-sessions/{session_id}/thread-replies",
    tag = "agent-sessions",
    operation_id = "put_agent_session_thread_replies",
    params(("session_id" = uuid::Uuid, Path, description = "ID of the agent session")),
    request_body = SetSessionThreadRepliesRequest,
    responses(
        (status = 200, body = SetSessionThreadRepliesRequest),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 404, body = String),
        (status = 409, body = String, description = "The session was not started from a thread"),
        (status = 500, body = String),
    )
)]
/// Pause or resume a session's unmentioned replies in its thread. While paused, the agent
/// answers only messages that mention it. Edit access.
#[tracing::instrument(skip_all, fields(paused = request.paused), err(Debug))]
pub async fn put_session_thread_replies<
    T: ThreadReplies,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: AgentSessionAccessLevelExtractor<EditAccessLevel, Access, Auth>,
    State(state): State<AgentSessionRouterState<T, Access, Auth>>,
    Json(request): Json<SetSessionThreadRepliesRequest>,
) -> Result<Json<SetSessionThreadRepliesRequest>, AgentSessionApiError> {
    state
        .service
        .set_paused(&access.entity_access_receipt, request.paused)
        .await?;
    Ok(Json(request))
}
