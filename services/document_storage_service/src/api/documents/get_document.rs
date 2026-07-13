use axum::{Extension, Json, extract::Path, http::StatusCode, response::IntoResponse};
use model::document::DocumentBasic;
use model::response::GenericErrorResponse;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct Params {
    pub document_id: String,
}

/// Gets the basic document info for a document id.
#[utoipa::path(
        tag = "document",
        get,
        path = "/documents/{document_id}/basic",
        operation_id = "get_document_basic",
        params(
            ("document_id" = String, Path, description = "Document ID")
        ),
        responses(
            (status = 200, body=DocumentBasic),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(document_basic))]
pub async fn get_document_basic_handler(
    Extension(document_basic): Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
) -> impl IntoResponse {
    (StatusCode::OK, Json(document_basic)).into_response()
}
