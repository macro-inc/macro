//! Thin transport adapters for associating pull requests with sessions.

use axum::{
    Json, Router,
    extract::{Query, State},
    http::StatusCode,
    routing::{get, post},
};
use entity_access::{
    domain::{
        models::{EditAccessLevel, ViewAccessLevel},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::AgentSessionAccessLevelExtractor,
};
use macro_authorization::{ActingUser, MacroAuthorizationExtractor, MacroAuthorizationService};
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{AgentSessionApiError, AgentSessionRouterState};
use crate::domain::pull_request_links::{
    PullRequestSessions, SessionPullRequestLink, SessionPullRequestLinks,
};

/// Pull request routes, mounted below `/agent-sessions`.
pub fn agent_session_pull_request_router<T, Access, Auth, S>(
    state: AgentSessionRouterState<T, Access, Auth>,
) -> Router<S>
where
    T: SessionPullRequestLinks,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/{session_id}/pull-requests",
            get(list_session_pull_requests::<T, Access, Auth>)
                .put(link_session_pull_request::<T, Access, Auth>)
                .delete(unlink_session_pull_request::<T, Access, Auth>),
        )
        .route(
            "/by-pull-request",
            post(sessions_for_pull_request::<T, Access, Auth>),
        )
        .route(
            "/by-pull-requests",
            post(sessions_for_pull_requests::<T, Access, Auth>),
        )
        .with_state(state)
}

/// A GitHub pull request, by URL.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestUrl {
    /// The pull request's GitHub URL, such as `https://github.com/owner/repo/pull/12`.
    pub url: String,
}

/// GitHub pull requests, by URL.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestUrls {
    /// Pull request GitHub URLs, at most 100.
    pub urls: Vec<String>,
}

/// The sessions associated with each requested pull request.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestsSessionsResponse {
    /// One entry per requested pull request, in request order.
    pub pull_requests: Vec<PullRequestSessions>,
}

/// The pull requests associated with a session.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionPullRequestsResponse {
    /// Pull requests, oldest link first.
    pub pull_requests: Vec<SessionPullRequestLink>,
}

/// The sessions associated with a pull request.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestSessionsResponse {
    /// Sessions associated with the pull request that the caller can view.
    pub session_ids: Vec<Uuid>,
}

#[utoipa::path(
    get,
    path = "/agent-sessions/{session_id}/pull-requests",
    tag = "agent-sessions",
    operation_id = "list_agent_session_pull_requests",
    params(("session_id" = Uuid, Path, description = "ID of the agent session")),
    responses(
        (status = 200, body = SessionPullRequestsResponse),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 500, body = String),
    )
)]
/// List the pull requests associated with a session the caller can view.
#[tracing::instrument(skip_all, err(Debug))]
pub async fn list_session_pull_requests<
    T: SessionPullRequestLinks,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: AgentSessionAccessLevelExtractor<ViewAccessLevel, Access, Auth>,
    State(state): State<AgentSessionRouterState<T, Access, Auth>>,
) -> Result<Json<SessionPullRequestsResponse>, AgentSessionApiError> {
    Ok(Json(SessionPullRequestsResponse {
        pull_requests: state
            .service
            .session_pull_requests(&access.entity_access_receipt)
            .await?,
    }))
}

#[utoipa::path(
    put,
    path = "/agent-sessions/{session_id}/pull-requests",
    tag = "agent-sessions",
    operation_id = "link_agent_session_pull_request",
    params(("session_id" = Uuid, Path, description = "ID of the agent session")),
    request_body = PullRequestUrl,
    responses(
        (status = 204),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 500, body = String),
    )
)]
/// Link a pull request to a session the caller can edit.
#[tracing::instrument(skip_all, err(Debug))]
pub async fn link_session_pull_request<
    T: SessionPullRequestLinks,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: AgentSessionAccessLevelExtractor<EditAccessLevel, Access, Auth>,
    State(state): State<AgentSessionRouterState<T, Access, Auth>>,
    Json(request): Json<PullRequestUrl>,
) -> Result<StatusCode, AgentSessionApiError> {
    state
        .service
        .link_pull_request(&access.entity_access_receipt, &request.url)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    delete,
    path = "/agent-sessions/{session_id}/pull-requests",
    tag = "agent-sessions",
    operation_id = "unlink_agent_session_pull_request",
    params(
        ("session_id" = Uuid, Path, description = "ID of the agent session"),
        ("url" = String, Query, description = "The pull request's GitHub URL"),
    ),
    responses(
        (status = 204),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 500, body = String),
    )
)]
/// Unlink a pull request a person linked to a session the caller can edit. The pull request
/// the session's agent opened stays linked.
#[tracing::instrument(skip_all, err(Debug))]
pub async fn unlink_session_pull_request<
    T: SessionPullRequestLinks,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: AgentSessionAccessLevelExtractor<EditAccessLevel, Access, Auth>,
    State(state): State<AgentSessionRouterState<T, Access, Auth>>,
    Query(request): Query<PullRequestUrl>,
) -> Result<StatusCode, AgentSessionApiError> {
    state
        .service
        .unlink_pull_request(&access.entity_access_receipt, &request.url)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/agent-sessions/by-pull-request",
    tag = "agent-sessions",
    operation_id = "agent_sessions_for_pull_request",
    request_body = PullRequestUrl,
    responses(
        (status = 200, body = PullRequestSessionsResponse),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 500, body = String),
    )
)]
/// List the sessions associated with a pull request that the caller can view.
#[tracing::instrument(skip_all, err(Debug))]
pub async fn sessions_for_pull_request<
    T: SessionPullRequestLinks,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<AgentSessionRouterState<T, Access, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, ActingUser>,
    Json(request): Json<PullRequestUrl>,
) -> Result<Json<PullRequestSessionsResponse>, AgentSessionApiError> {
    let sessions = state
        .service
        .sessions_for_pull_request(&caller.authorization.user.macro_user_id, &request.url)
        .await?;
    Ok(Json(PullRequestSessionsResponse {
        session_ids: sessions
            .into_iter()
            .map(|session| session.as_uuid())
            .collect(),
    }))
}

#[utoipa::path(
    post,
    path = "/agent-sessions/by-pull-requests",
    tag = "agent-sessions",
    operation_id = "agent_sessions_for_pull_requests",
    request_body = PullRequestUrls,
    responses(
        (status = 200, body = PullRequestsSessionsResponse),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 500, body = String),
    )
)]
/// List the sessions associated with each of up to 100 pull requests that the caller can view,
/// with the thread each session was started from.
#[tracing::instrument(skip_all, err(Debug))]
pub async fn sessions_for_pull_requests<
    T: SessionPullRequestLinks,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<AgentSessionRouterState<T, Access, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, ActingUser>,
    Json(request): Json<PullRequestUrls>,
) -> Result<Json<PullRequestsSessionsResponse>, AgentSessionApiError> {
    Ok(Json(PullRequestsSessionsResponse {
        pull_requests: state
            .service
            .sessions_for_pull_requests(&caller.authorization.user.macro_user_id, &request.urls)
            .await?,
    }))
}
