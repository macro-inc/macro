use crate::api::context::ApiContext;

use axum::{
    Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use github::domain::{
    models::{EnrichGithubPullRequestsRequest, EnrichGithubPullRequestsResponse, GithubError},
    ports::GithubLinkService,
};
use macro_middleware::auth::internal_access::ValidInternalKey;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserId};
use model::response::ErrorResponse;

#[derive(thiserror::Error, Debug)]
pub enum EnrichGithubPullRequestsError {
    #[error("invalid macro user id")]
    InvalidMacroUserId,
    #[error(transparent)]
    Github(#[from] GithubError),
}

impl IntoResponse for EnrichGithubPullRequestsError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            Self::InvalidMacroUserId => StatusCode::BAD_REQUEST,
            Self::Github(GithubError::NoLinkFound) => StatusCode::NOT_FOUND,
            Self::Github(GithubError::AccountAlreadyLinked) => StatusCode::BAD_REQUEST,
            Self::Github(GithubError::NoRefreshTokenProvided) => StatusCode::UNPROCESSABLE_ENTITY,
            Self::Github(GithubError::InvalidWebhookSignature) => StatusCode::UNAUTHORIZED,
            Self::Github(GithubError::Internal(error)) => {
                tracing::error!(error=?error, "failed to enrich GitHub pull requests");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };

        let message = match &self {
            Self::InvalidMacroUserId => "invalid macro user id".to_string(),
            Self::Github(GithubError::NoLinkFound) => "no github link found".to_string(),
            Self::Github(GithubError::Internal(_)) => "internal error".to_string(),
            Self::Github(error) => error.to_string(),
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

/// Enriches GitHub pull request references with live GitHub data.
#[tracing::instrument(skip(ctx, _valid_access, request), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    _valid_access: ValidInternalKey,
    extract::Json(request): extract::Json<EnrichGithubPullRequestsRequest>,
) -> Result<Json<EnrichGithubPullRequestsResponse>, EnrichGithubPullRequestsError> {
    tracing::info!("internal_enrich_github_pull_requests");

    let macro_user_id = MacroUserId::parse_from_str(request.macro_user_id.as_str())
        .map(|user_id| user_id.into_owned().lowercase())
        .map_err(|_| EnrichGithubPullRequestsError::InvalidMacroUserId)?;

    let pull_requests = ctx
        .github_link_service
        .enrich_pull_requests(&macro_user_id, request.pull_requests)
        .await?;

    Ok(Json(EnrichGithubPullRequestsResponse { pull_requests }))
}
