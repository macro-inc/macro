use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use macro_middleware::cloud_storage::ensure_access::document::DocumentAccessExtractor;
use model::response::GenericErrorResponse;
use models_permissions::share_permission::access_level::ViewAccessLevel;
use sqlx::PgPool;
use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, ToSchema)]
pub struct GetDocumentTextResponse {
    pub text: String,
}

#[derive(serde::Deserialize)]
pub struct Params {
    pub document_id: String,
}

#[utoipa::path(
        get,
        path = "/documents/{document_id}/text",
        operation_id = "get_document_text",
        params(
            ("document_id" = String, Path, description = "Document ID")
        ),
        responses(
            (status = 200, body=GetDocumentTextResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(db, _access))]
pub async fn handler(
    _access: DocumentAccessExtractor<ViewAccessLevel>,
    State(db): State<PgPool>,
    Path(Params { document_id }): Path<Params>,
) -> impl IntoResponse {
    tracing::debug!(document_id = %document_id, "Getting document text");

    let text = match macro_db_client::document_text::get_document_text(&db, &document_id).await {
        Ok(text) => text,
        Err(e) => {
            tracing::error!(error = %e, document_id = %document_id, "Failed to get document text");
            match e {
                sqlx::Error::RowNotFound => {
                    return (StatusCode::NOT_FOUND, "Document text not found".to_string())
                        .into_response();
                }
                _ => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to retrieve document text".to_string(),
                    )
                        .into_response();
                }
            }
        }
    };

    (StatusCode::OK, Json(GetDocumentTextResponse { text })).into_response()
}
