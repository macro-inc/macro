//! Axum routes serving a GitHub pull request's changes, merged beside the pull request routes.
//!
//! Both routes resolve view access to the caller's foreign entity record before the handler
//! runs, the same check as `GET /foreign_entity/{id}`. The diff is read with the caller's own
//! GitHub repository access.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use entity_access::{
    domain::{models::ViewAccessLevel, ports::EntityAccessService},
    inbound::axum_extractors::ForeignEntityAccessLevelExtractor,
};
pub use git_patch::wire::{
    ChangedFileDto, ChangesetDto, ChangesetSourceDto, FileChangeKindDto, GitRefDto,
};
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use model_error_response::ErrorResponse;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::{
    models::{GithubPullRequestChangesError, GithubPullRequestChangeset},
    ports::GithubPullRequestChanges,
};

/// Router state for the pull request changes routes.
pub struct GithubPullRequestChangesRouterState<S, AccessSvc, Auth> {
    service: Arc<S>,
    access_service: Arc<AccessSvc>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, AccessSvc, Auth> Clone for GithubPullRequestChangesRouterState<S, AccessSvc, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            access_service: self.access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, AccessSvc, Auth> GithubPullRequestChangesRouterState<S, AccessSvc, Auth>
where
    S: GithubPullRequestChanges,
    AccessSvc: EntityAccessService,
{
    /// Create router state from shared service references and authorization state.
    pub fn new(
        service: Arc<S>,
        access_service: Arc<AccessSvc>,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service,
            access_service,
            authorization_state,
        }
    }
}

impl<S, AccessSvc, Auth> FromRef<GithubPullRequestChangesRouterState<S, AccessSvc, Auth>>
    for Arc<AccessSvc>
{
    fn from_ref(state: &GithubPullRequestChangesRouterState<S, AccessSvc, Auth>) -> Self {
        state.access_service.clone()
    }
}

impl<S, AccessSvc, Auth> FromRef<GithubPullRequestChangesRouterState<S, AccessSvc, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &GithubPullRequestChangesRouterState<S, AccessSvc, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the pull request changes router.
///
/// Routes:
/// - `GET /{id}/changes` — the changes at the pull request's current base and head.
/// - `GET /{id}/changes/patch?changeset=` — the patch of those changes.
pub fn github_pull_request_changes_router<S, AccessSvc, Auth, T>(
    state: GithubPullRequestChangesRouterState<S, AccessSvc, Auth>,
) -> Router<T>
where
    S: GithubPullRequestChanges,
    AccessSvc: EntityAccessService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/{id}/changes",
            get(get_github_pull_request_changes_handler::<S, AccessSvc, Auth>),
        )
        .route(
            "/{id}/changes/patch",
            get(get_github_pull_request_changes_patch_handler::<S, AccessSvc, Auth>),
        )
        .with_state(state)
}

/// Response body for `GET /github_pull_requests/{id}/changes`.
///
/// Clients deserialize this, so both derives are used.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GithubPullRequestChangesResponse {
    /// The changes at the pull request's current base and head; absent when GitHub could not
    /// provide them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changeset: Option<ChangesetDto>,
    /// Why there are no changes, in a sentence the user can act on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Response body for `GET /github_pull_requests/{id}/changes/patch`.
///
/// Clients deserialize this, so both derives are used.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GithubPullRequestChangesPatchResponse {
    /// The git-style unified diff of the changeset.
    pub patch: String,
}

/// Query for `GET /github_pull_requests/{id}/changes/patch`.
#[derive(Debug, Deserialize)]
pub struct ChangesPatchQuery {
    /// The changeset whose patch to read.
    pub changeset: Uuid,
}

/// Get the changes of the pull request behind a foreign entity record the caller can view.
#[utoipa::path(
    get,
    tag = "github_pull_requests",
    operation_id = "get_github_pull_request_changes",
    path = "/github_pull_requests/{id}/changes",
    params(
        ("id" = uuid::Uuid, Path, description = "The caller's foreign entity record for the pull request")
    ),
    responses(
        (status = 200, body = GithubPullRequestChangesResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_github_pull_request_changes_handler<S, AccessSvc, Auth>(
    State(state): State<GithubPullRequestChangesRouterState<S, AccessSvc, Auth>>,
    access: ForeignEntityAccessLevelExtractor<ViewAccessLevel, AccessSvc, Auth>,
) -> Result<Json<GithubPullRequestChangesResponse>, GithubPullRequestChangesError>
where
    S: GithubPullRequestChanges,
    AccessSvc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    match state.service.changes(access.entity_access_receipt).await {
        Ok(changeset) => Ok(Json(GithubPullRequestChangesResponse {
            changeset: Some(changeset_dto(changeset)),
            error: None,
        })),
        Err(GithubPullRequestChangesError::Diff(error)) => match error.user_message() {
            Some(message) => Ok(Json(GithubPullRequestChangesResponse {
                changeset: None,
                error: Some(message.to_string()),
            })),
            None => Err(GithubPullRequestChangesError::Diff(error)),
        },
        Err(error) => Err(error),
    }
}

/// Get the patch of changes of the pull request behind a foreign entity record the caller can
/// view.
#[utoipa::path(
    get,
    tag = "github_pull_requests",
    operation_id = "get_github_pull_request_changes_patch",
    path = "/github_pull_requests/{id}/changes/patch",
    params(
        ("id" = uuid::Uuid, Path, description = "The caller's foreign entity record for the pull request"),
        ("changeset" = uuid::Uuid, Query, description = "The changeset whose patch to read")
    ),
    responses(
        (status = 200, body = GithubPullRequestChangesPatchResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_github_pull_request_changes_patch_handler<S, AccessSvc, Auth>(
    State(state): State<GithubPullRequestChangesRouterState<S, AccessSvc, Auth>>,
    access: ForeignEntityAccessLevelExtractor<ViewAccessLevel, AccessSvc, Auth>,
    Query(query): Query<ChangesPatchQuery>,
) -> Result<Json<GithubPullRequestChangesPatchResponse>, GithubPullRequestChangesError>
where
    S: GithubPullRequestChanges,
    AccessSvc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let patch = state
        .service
        .patch(access.entity_access_receipt, query.changeset)
        .await?;
    Ok(Json(GithubPullRequestChangesPatchResponse { patch }))
}

fn changeset_dto(changeset: GithubPullRequestChangeset) -> ChangesetDto {
    ChangesetDto {
        id: changeset.id,
        source: ChangesetSourceDto::GithubPullRequest,
        repository: changeset.range.repository,
        base: changeset.range.base.into(),
        head: changeset.range.head.into(),
        files: changeset.files.into_iter().map(Into::into).collect(),
        additions: changeset.additions,
        deletions: changeset.deletions,
        patch_bytes: changeset.patch_bytes,
        truncated: changeset.truncated,
        captured_at: changeset.captured_at,
    }
}

impl IntoResponse for GithubPullRequestChangesError {
    fn into_response(self) -> Response {
        let error = match self {
            GithubPullRequestChangesError::PullRequest(error) => return error.into_response(),
            error => error,
        };
        let (status_code, message) = match &error {
            GithubPullRequestChangesError::NotFound => (
                StatusCode::NOT_FOUND,
                "pull request changes not found".to_string(),
            ),
            GithubPullRequestChangesError::Unauthorized => {
                (StatusCode::UNAUTHORIZED, error.to_string())
            }
            GithubPullRequestChangesError::Moved => (StatusCode::CONFLICT, error.to_string()),
            GithubPullRequestChangesError::Diff(diff) => match diff.user_message() {
                Some(message) => (StatusCode::CONFLICT, message.to_string()),
                None => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal server error".to_string(),
                ),
            },
            GithubPullRequestChangesError::PullRequest(_)
            | GithubPullRequestChangesError::Storage(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal server error".to_string(),
            ),
        };

        if status_code.is_server_error() {
            tracing::error!(error=?error, "internal server error");
        }

        (
            status_code,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}
