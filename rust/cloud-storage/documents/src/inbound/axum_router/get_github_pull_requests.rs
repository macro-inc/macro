//! Handler for `GET /documents/{document_id}/github_prs`.

use axum::{
    Extension, Json,
    extract::{Path, State},
};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::DocumentAccessExtractor;
use model::document::DocumentBasic;
use models_permissions::share_permission::access_level::ViewAccessLevel;

use super::{DocumentRouterState, Params};
use crate::domain::models::{DocumentError, GithubPullRequestsResponse};
use crate::domain::ports::DocumentService;

/// Handler for `GET /documents/{document_id}/github_prs`.
///
/// Returns GitHub pull requests associated with a task document.
/// Returns 400 if the document is not a task.
#[utoipa::path(
    tag = "document",
    get,
    path = "/documents/{document_id}/github_prs",
    operation_id = "get_document_github_pull_requests",
    params(
        ("document_id" = String, Path, description = "Document ID")
    ),
    responses(
        (status = 200, body = GithubPullRequestsResponse),
        (status = 400, body = model_error_response::ErrorResponse),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 404, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, access, document_context), err)]
pub async fn get_github_pull_requests_handler<T: DocumentService, Svc: EntityAccessService>(
    access: DocumentAccessExtractor<ViewAccessLevel, Svc>,
    State(state): State<DocumentRouterState<T, Svc>>,
    Extension(document_context): Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
) -> Result<Json<GithubPullRequestsResponse>, DocumentError> {
    let response = state
        .service
        .get_task_github_pull_requests(access.entity_access_receipt, &document_context)
        .await?;

    Ok(Json(response))
}

#[cfg(test)]
mod tests {
    use serde_json::Value;
    use utoipa::OpenApi;

    #[derive(OpenApi)]
    #[openapi(
        paths(super::get_github_pull_requests_handler),
        components(schemas(
            crate::domain::models::GithubPullRequest,
            crate::domain::models::GithubPullRequestsResponse,
        ))
    )]
    struct ApiDoc;

    #[test]
    fn get_github_pull_requests_openapi_documents_expected_responses() {
        let openapi = serde_json::to_value(ApiDoc::openapi()).expect("OpenAPI should serialize");
        let responses = openapi
            .pointer("/paths/~1documents~1{document_id}~1github_prs/get/responses")
            .and_then(Value::as_object)
            .expect("GitHub PR endpoint should be documented");

        for status in ["200", "400", "401", "404", "500"] {
            assert!(
                responses.contains_key(status),
                "expected {status} response to be documented"
            );
        }
    }
}
