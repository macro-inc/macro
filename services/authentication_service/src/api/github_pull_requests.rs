use axum::{
    Json, Router,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use github::domain::{
    models::{EnrichGithubPullRequestsProxyRequest, EnrichGithubPullRequestsResponse, GithubError},
    ports::GithubLinkService,
};
use model::response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;

use crate::api::context::ApiContext;

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

pub fn router() -> Router<ApiContext> {
    Router::new().route("/enrich", post(handler))
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
#[tracing::instrument(skip(ctx, user_context, request), fields(user_id = %user_context.macro_user_id), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: MacroUserExtractor,
    extract::Json(request): extract::Json<EnrichGithubPullRequestsProxyRequest>,
) -> Result<Json<EnrichGithubPullRequestsResponse>, EnrichGithubPullRequestsProxyError> {
    tracing::info!("enrich_github_pull_requests");

    let pull_requests = ctx
        .github_link_service
        .enrich_pull_requests(&user_context.macro_user_id, request.pull_requests)
        .await?;

    Ok(Json(EnrichGithubPullRequestsResponse { pull_requests }))
}
