//! Handler for `GET /documents/{document_id}/branch_name`.

use axum::{
    Json,
    extract::{Path, State},
};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::DocumentAccessExtractor;
use models_permissions::share_permission::access_level::ViewAccessLevel;

use super::{DocumentRouterState, Params};
use crate::domain::branch_name::build_task_branch_name;
use crate::domain::models::DocumentError;
use crate::domain::ports::DocumentService;
use document_sub_type::DocumentSubType;

/// Branch name response.
#[derive(serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BranchNameResponse {
    /// The short id of the document.
    pub short_id: String,
    /// The git branch name for the document. Only present when the document is a task.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_name: Option<String>,
}

/// Handler for `GET /documents/{document_id}/branch_name`.
///
/// Returns the short UUID for a document and, if the document is a task,
/// its corresponding git branch name.
#[utoipa::path(
    tag = "document",
    get,
    path = "/documents/{document_id}/branch_name",
    operation_id = "get_document_branch_name",
    params(
        ("document_id" = String, Path, description = "Document ID")
    ),
    responses(
        (status = 200, body = BranchNameResponse),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 404, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, access), err)]
pub async fn get_branch_name_handler<T: DocumentService, Svc: EntityAccessService>(
    State(state): State<DocumentRouterState<T, Svc>>,
    access: DocumentAccessExtractor<ViewAccessLevel, Svc>,
    Path(Params { document_id }): Path<Params>,
) -> Result<Json<BranchNameResponse>, DocumentError> {
    let receipt = access.entity_access_receipt;

    let document = state.service.get_document(receipt.clone()).await?;
    let short_id = state.service.get_short_id(receipt).await?;

    let branch_name = match document.document_metadata.sub_type {
        Some(DocumentSubType::Task) => Some(build_task_branch_name(
            &short_id,
            &document.document_metadata.document_name,
        )),
        None => None,
    };

    Ok(Json(BranchNameResponse {
        short_id,
        branch_name,
    }))
}
