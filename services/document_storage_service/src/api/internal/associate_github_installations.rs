use crate::api::context::ApiContext;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use github::domain::ports::GithubSyncService;
use model::response::{EmptyResponse, GenericErrorResponse};

#[derive(serde::Deserialize)]
pub struct Params {
    pub github_user_id: String,
}

/// Associates GitHub App installations installed by the given GitHub user with
/// that user's Macro sources. Called by the authentication service after a
/// `github_links` row is created, so installations made before linking get
/// associated retroactively.
#[utoipa::path(
    post,
    path = "/github/installations/{github_user_id}/associate",
    operation_id = "associate_github_installations",
    params(
        ("github_user_id" = String, Path, description = "Stable numeric GitHub user ID")
    ),
    responses(
        (status = 200, body = EmptyResponse),
        (status = 401, body = GenericErrorResponse),
        (status = 500, body = GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx), err(Debug))]
pub async fn associate_github_installations_handler(
    State(ctx): State<ApiContext>,
    Path(Params { github_user_id }): Path<Params>,
) -> Result<Response, Response> {
    ctx.github_sync_service
        .associate_installations_for_github_user(&github_user_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to associate github installations");
            (StatusCode::INTERNAL_SERVER_ERROR).into_response()
        })?;

    Ok((StatusCode::OK, axum::Json(EmptyResponse {})).into_response())
}
