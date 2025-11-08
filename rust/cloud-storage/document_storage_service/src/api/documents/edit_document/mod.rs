mod edit_document_v2;

use crate::{api::context::ApiContext, model::request::documents::edit::EditDocumentRequestV2};
use axum::{
    Extension, Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_middleware::cloud_storage::ensure_access::{
    document::DocumentAccessExtractor, project::ProjectBodyAccessLevelExtractor,
};
use model::{
    document::DocumentBasic,
    response::{ErrorResponse, GenericErrorResponse, SuccessResponse},
    user::UserContext,
};
use models_permissions::share_permission::access_level::EditAccessLevel;

#[derive(serde::Deserialize)]
pub struct Params {
    pub document_id: String,
}

/// Edit document v2
/// Edits traits of a document such as owner, or name as well as modify the documents share
/// permissions.
#[utoipa::path(
        tag = "document",
        patch,
        operation_id="edit_document_v2",
        path = "/v2/documents/{document_id}",
        params(
            ("document_id" = String, Path, description = "Document ID")
        ),
        responses(
            (status = 200, body=SuccessResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[allow(unused, reason = "used to generate OpenAPI documentation")]
pub(in crate::api) async fn edit_document_handler_v2(
    extract::Path(Params { document_id }): extract::Path<Params>,
    extract::Json(_req): extract::Json<EditDocumentRequestV2>,
) -> impl IntoResponse {
    StatusCode::OK
}

/// Edits traits of a document such as owner, or name.
#[tracing::instrument(skip(state, user_context, project), fields(user_id=?user_context.user_id))]
pub async fn edit_document_handler(
    DocumentAccessExtractor { access_level, .. }: DocumentAccessExtractor<EditAccessLevel>,
    State(state): State<ApiContext>,
    user_context: Extension<UserContext>,
    document_context: Extension<DocumentBasic>,
    extract::Path(Params { document_id }): extract::Path<Params>,
    project: ProjectBodyAccessLevelExtractor<EditAccessLevel, EditDocumentRequestV2>,
) -> Result<Response, Response> {
    let req = project.into_inner();

    if document_context.deleted_at.is_some() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "cannot modify deleted document",
            }),
        )
            .into_response());
    }

    edit_document_v2::edit_document(&state, document_context.0, access_level, req, &user_context)
        .await
}
