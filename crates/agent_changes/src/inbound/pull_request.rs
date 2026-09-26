//! Authenticated reads of standalone pull request changes.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::domain::{
    error::CompareError,
    model::PullRequestRef,
    pull_request::{PullRequestChangesService, PullRequestSnapshot},
};

use super::axum_router::{ChangesetDto, ChangesetSourceDto};

#[cfg(test)]
mod test;

/// Service and authenticated identity used by the pull request endpoint.
pub struct PullRequestChangesRouterState<Service, Auth> {
    service: Arc<Service>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<Service, Auth> PullRequestChangesRouterState<Service, Auth> {
    /// Construct state; the service's reader authorizes repository access.
    pub fn new(service: Service, authorization_state: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service: Arc::new(service),
            authorization_state,
        }
    }
}

impl<Service, Auth> Clone for PullRequestChangesRouterState<Service, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Service, Auth> FromRef<PullRequestChangesRouterState<Service, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &PullRequestChangesRouterState<Service, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Serve standalone PR changes without requiring an agent session.
pub fn pull_request_changes_router<Service, Auth, S>(
    state: PullRequestChangesRouterState<Service, Auth>,
) -> Router<S>
where
    Service: PullRequestChangesService,
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/pull-requests/changes",
            get(get_pull_request_changes_handler::<Service, Auth>),
        )
        .with_state(state)
}

/// The PR URL to read. Only validated GitHub pull request URLs are accepted.
#[derive(Deserialize)]
pub struct PullRequestChangesQuery {
    /// The canonical GitHub pull request URL.
    pub url: String,
}

/// A summary and its matching unified patch, returned as one snapshot.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestChangesResponse {
    /// The files and refs in this read.
    pub changeset: ChangesetDto,
    /// The budgeted patch described by the summary.
    pub patch: String,
}

impl From<PullRequestSnapshot> for PullRequestChangesResponse {
    fn from(snapshot: PullRequestSnapshot) -> Self {
        Self {
            changeset: ChangesetDto {
                id: snapshot.id.as_uuid(),
                source: ChangesetSourceDto::GithubPullRequest,
                repository: snapshot.range.repository,
                base: snapshot.range.base.into(),
                head: snapshot.range.head.into(),
                files: snapshot.files.into_iter().map(Into::into).collect(),
                additions: snapshot.additions,
                deletions: snapshot.deletions,
                patch_bytes: snapshot.patch.len() as u64,
                truncated: snapshot.truncated,
                captured_at: snapshot.captured_at,
            },
            patch: snapshot.patch,
        }
    }
}

/// Public errors for a standalone PR read.
#[derive(Debug)]
pub enum PullRequestChangesApiError {
    /// The input did not name a GitHub pull request.
    InvalidUrl,
    /// The reader refused or failed the request.
    Compare(CompareError),
}

impl From<CompareError> for PullRequestChangesApiError {
    fn from(error: CompareError) -> Self {
        Self::Compare(error)
    }
}

impl IntoResponse for PullRequestChangesApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::InvalidUrl => (
                StatusCode::BAD_REQUEST,
                "The URL must name a GitHub pull request.",
            ),
            Self::Compare(CompareError::NotFound) => (
                StatusCode::NOT_FOUND,
                "This pull request is not available on GitHub.",
            ),
            Self::Compare(CompareError::Unavailable) => (
                StatusCode::FORBIDDEN,
                "Macro's GitHub App cannot read this pull request. Check its repository access.",
            ),
            Self::Compare(CompareError::TooLarge) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "This pull request is too large to load here. Review it on GitHub.",
            ),
            Self::Compare(CompareError::Other(error)) => {
                tracing::error!(error = ?error, "pull request changes request failed");
                (
                    StatusCode::BAD_GATEWAY,
                    "GitHub could not load this pull request's changes. Try again.",
                )
            }
        };
        (status, message).into_response()
    }
}

/// Read a GitHub PR through the authenticated viewer's repository access.
#[utoipa::path(
    get,
    path = "/pull-requests/changes",
    tag = "pull-requests",
    operation_id = "get_pull_request_changes",
    params(("url" = String, Query, description = "GitHub pull request URL")),
    responses(
        (status = 200, body = PullRequestChangesResponse),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 404, body = String),
        (status = 422, body = String),
        (status = 502, body = String),
    )
)]
#[tracing::instrument(skip_all, err(Debug))]
pub async fn get_pull_request_changes_handler<
    Service: PullRequestChangesService,
    Auth: MacroAuthorizationService,
>(
    authorization: MacroAuthorizationExtractor<Auth, UserOnly>,
    State(state): State<PullRequestChangesRouterState<Service, Auth>>,
    Query(query): Query<PullRequestChangesQuery>,
) -> Result<Json<PullRequestChangesResponse>, PullRequestChangesApiError> {
    let pull_request =
        PullRequestRef::parse(&query.url).ok_or(PullRequestChangesApiError::InvalidUrl)?;
    let snapshot = state
        .service
        .changes(&authorization.authorization.macro_user_id, &pull_request)
        .await?;
    Ok(Json(snapshot.into()))
}
