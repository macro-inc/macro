use axum::{
    Json, Router,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use github::domain::{
    models::{
        EnrichGithubPullRequestsProxyRequest, EnrichGithubPullRequestsResponse, GithubError,
        MergeGithubPullRequestRequest, MergeGithubPullRequestResponse,
    },
    ports::GithubLinkService,
};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::ErrorResponse;

use crate::api::context::{ApiContext, AuthorizationService};

#[derive(thiserror::Error, Debug)]
pub enum EnrichGithubPullRequestsProxyError {
    #[error(transparent)]
    Github(#[from] GithubError),
}

impl IntoResponse for EnrichGithubPullRequestsProxyError {
    fn into_response(self) -> Response {
        let (status_code, message) = match &self {
            Self::Github(GithubError::NoLinkFound) => {
                (StatusCode::NOT_FOUND, "no github link found")
            }
            Self::Github(GithubError::ReauthenticationRequired) => (
                StatusCode::PRECONDITION_REQUIRED,
                "reauthentication required",
            ),
            Self::Github(error) => {
                tracing::error!(error=?error, "failed to enrich GitHub pull requests");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal error")
            }
        };

        (
            status_code,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}

#[derive(thiserror::Error, Debug)]
pub enum MergeGithubPullRequestError {
    #[error(transparent)]
    Github(#[from] GithubError),
}

impl IntoResponse for MergeGithubPullRequestError {
    fn into_response(self) -> Response {
        let (status_code, message) = match self {
            Self::Github(GithubError::NoLinkFound) => {
                (StatusCode::NOT_FOUND, "no github link found".to_string())
            }
            Self::Github(GithubError::ReauthenticationRequired) => (
                StatusCode::PRECONDITION_REQUIRED,
                "reauthentication required".to_string(),
            ),
            // GitHub's own message names what blocks the merge; the status
            // says which kind of refusal it is.
            Self::Github(GithubError::PullRequestMergeRejected { rejection, message }) => {
                (github::inbound::merge_rejection_status(rejection), message)
            }
            Self::Github(error) => {
                tracing::error!(error=?error, "failed to merge GitHub pull request");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal error".to_string(),
                )
            }
        };

        (
            status_code,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/enrich", post(handler))
        .route("/merge", post(merge_handler))
}

/// Enriches GitHub pull request references with live GitHub data for the authenticated user.
#[utoipa::path(
    post,
    path = "/github_pull_requests/enrich",
    operation_id = "enrich_github_pull_requests",
    request_body = EnrichGithubPullRequestsProxyRequest,
    responses(
        (status = 200, body = EnrichGithubPullRequestsResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 428, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization, request), fields(user_id = %authorization.authorization.user.macro_user_id), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    extract::Json(request): extract::Json<EnrichGithubPullRequestsProxyRequest>,
) -> Result<Json<EnrichGithubPullRequestsResponse>, EnrichGithubPullRequestsProxyError> {
    tracing::info!("enrich_github_pull_requests");

    let pull_requests = ctx
        .github_link_service
        .enrich_pull_requests(
            &authorization.authorization.user.macro_user_id,
            request.pull_requests,
        )
        .await?;

    Ok(Json(EnrichGithubPullRequestsResponse { pull_requests }))
}

/// Merges a GitHub pull request as the authenticated user, with their own
/// GitHub grant. GitHub applies the user's permissions and the repository's
/// branch protections; a refusal is returned with GitHub's message.
#[utoipa::path(
    post,
    path = "/github_pull_requests/merge",
    operation_id = "merge_github_pull_request",
    request_body = MergeGithubPullRequestRequest,
    responses(
        (status = 200, body = MergeGithubPullRequestResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, description = "The user cannot push to the repository", body = ErrorResponse),
        (status = 404, description = "No GitHub link, or the pull request is not visible to the user", body = ErrorResponse),
        (status = 409, description = "The pull request is not mergeable as it stands, or its head moved", body = ErrorResponse),
        (status = 422, body = ErrorResponse),
        (status = 428, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization, request), fields(user_id = %authorization.authorization.user.macro_user_id), err)]
pub async fn merge_handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    extract::Json(request): extract::Json<MergeGithubPullRequestRequest>,
) -> Result<Json<MergeGithubPullRequestResponse>, MergeGithubPullRequestError> {
    tracing::info!("merge_github_pull_request");

    let response = ctx
        .github_link_service
        .merge_pull_request(&authorization.authorization.user.macro_user_id, request)
        .await?;

    Ok(Json(response))
}
