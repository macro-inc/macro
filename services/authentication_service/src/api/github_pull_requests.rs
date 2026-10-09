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
        GithubPullRequestMergeabilityRequest, GithubPullRequestMergeabilityResponse,
        MergeGithubPullRequestRequest, MergeGithubPullRequestResponse,
        SetGithubPullRequestDraftRequest, SetGithubPullRequestDraftResponse,
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

#[derive(thiserror::Error, Debug)]
pub enum UpdateGithubPullRequestError {
    #[error(transparent)]
    Github(#[from] GithubError),
}

impl IntoResponse for UpdateGithubPullRequestError {
    fn into_response(self) -> Response {
        let (status_code, message) = match self {
            Self::Github(GithubError::NoLinkFound) => {
                (StatusCode::NOT_FOUND, "no github link found".to_string())
            }
            Self::Github(GithubError::ReauthenticationRequired) => (
                StatusCode::PRECONDITION_REQUIRED,
                "reauthentication required".to_string(),
            ),
            // GitHub's own message says why the change was declined.
            Self::Github(GithubError::PullRequestUpdateRejected { rejection, message }) => {
                (github::inbound::update_rejection_status(rejection), message)
            }
            Self::Github(GithubError::TooManyPullRequests) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "too many pull requests requested".to_string(),
            ),
            Self::Github(error) => {
                tracing::error!(error=?error, "failed to update GitHub pull request");
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
        .route("/draft", post(draft_handler))
        .route("/mergeability", post(mergeability_handler))
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

/// Converts a GitHub pull request to a draft, or marks it ready for review,
/// as the authenticated user with their own GitHub grant.
#[utoipa::path(
    post,
    path = "/github_pull_requests/draft",
    operation_id = "set_github_pull_request_draft",
    request_body = SetGithubPullRequestDraftRequest,
    responses(
        (status = 200, body = SetGithubPullRequestDraftResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, description = "The user cannot change the pull request", body = ErrorResponse),
        (status = 404, description = "No GitHub link, or the pull request is not visible to the user", body = ErrorResponse),
        (status = 422, description = "GitHub declined the change", body = ErrorResponse),
        (status = 428, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization, request), fields(user_id = %authorization.authorization.user.macro_user_id), err)]
pub async fn draft_handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    extract::Json(request): extract::Json<SetGithubPullRequestDraftRequest>,
) -> Result<Json<SetGithubPullRequestDraftResponse>, UpdateGithubPullRequestError> {
    tracing::info!("set_github_pull_request_draft");

    let response = ctx
        .github_link_service
        .set_pull_request_draft(&authorization.authorization.user.macro_user_id, request)
        .await?;

    Ok(Json(response))
}

/// Reads whether each GitHub pull request merges cleanly into its base, as
/// the authenticated user sees it. Pull requests the user cannot see are
/// left out.
#[utoipa::path(
    post,
    path = "/github_pull_requests/mergeability",
    operation_id = "get_github_pull_request_mergeability",
    request_body = GithubPullRequestMergeabilityRequest,
    responses(
        (status = 200, body = GithubPullRequestMergeabilityResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, description = "No GitHub link", body = ErrorResponse),
        (status = 422, description = "Too many pull requests requested", body = ErrorResponse),
        (status = 428, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization, request), fields(user_id = %authorization.authorization.user.macro_user_id), err)]
pub async fn mergeability_handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    extract::Json(request): extract::Json<GithubPullRequestMergeabilityRequest>,
) -> Result<Json<GithubPullRequestMergeabilityResponse>, UpdateGithubPullRequestError> {
    let pull_requests = ctx
        .github_link_service
        .get_pull_request_mergeability(
            &authorization.authorization.user.macro_user_id,
            request.pull_requests,
        )
        .await?;

    Ok(Json(GithubPullRequestMergeabilityResponse {
        pull_requests,
    }))
}
