//! Handler for `POST /documents/github_prs/tasks`.

use axum::{Json, extract::State};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{ActingUser, MacroAuthorizationExtractor, MacroAuthorizationService};

use super::DocumentRouterState;
use crate::domain::models::{
    DocumentError, GithubPullRequestTasksRequest, GithubPullRequestTasksResponse,
};
use crate::domain::ports::DocumentService;

/// Handler for `POST /documents/github_prs/tasks`.
///
/// Returns the task documents each of up to 100 GitHub pull requests references, for the pull
/// requests the caller can see.
#[utoipa::path(
    tag = "document",
    post,
    path = "/documents/github_prs/tasks",
    operation_id = "get_github_pull_request_tasks",
    request_body = GithubPullRequestTasksRequest,
    responses(
        (status = 200, body = GithubPullRequestTasksResponse),
        (status = 400, body = model_error_response::ErrorResponse),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, err)]
pub async fn get_github_pull_request_tasks_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, ActingUser>,
    Json(request): Json<GithubPullRequestTasksRequest>,
) -> Result<Json<GithubPullRequestTasksResponse>, DocumentError> {
    let user_id = caller.authorization.user.macro_user_id;
    Ok(Json(
        state
            .service
            .get_github_pull_request_tasks(user_id.as_ref(), request.github_keys)
            .await?,
    ))
}
