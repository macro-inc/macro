use crate::api::context::{AuthorizationService, EntityAccessService};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use entity_access::inbound::axum_extractors::DocumentAccessExtractor;
use macro_authorization::MacroAuthorizationExtractor;
use model::response::GenericErrorResponse;
use model::response::GenericResponse;
use models_permissions::share_permission::access_level::ViewAccessLevel;
use sqlx::PgPool;

use crate::model::response::documents::get::GetDocumentProcessingResultResponse;

#[derive(serde::Deserialize)]
pub struct Params {
    pub document_id: String,
}

/// Fetches the document pdf processing result for a given document id
#[utoipa::path(
        tag = "document",
        get,
        path = "/documents/{document_id}/processing",
    operation_id = "get_document_processing_result",
    params(
        ("document_id" = String, Path, description = "Document ID")
    ),
        responses(
            (status = 200, body=GetDocumentProcessingResultResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(db, user, _access), fields(user_id=?user.macro_user_id))]
pub async fn handler(
    _access: DocumentAccessExtractor<ViewAccessLevel, EntityAccessService, AuthorizationService>,
    State(db): State<PgPool>,
    user: MacroAuthorizationExtractor<AuthorizationService>,
    Path(Params { document_id }): Path<Params>,
) -> impl IntoResponse {
    let processing_result = match macro_db_client::document::get_document_process_content(
        &db,
        &document_id,
        "pdf_preprocess",
    )
    .await
    {
        Ok(content) => content,
        Err(err) => {
            tracing::error!(error=?err, "unable to get processing result");
            match err {
                sqlx::Error::RowNotFound => {
                    return GenericResponse::builder()
                        .message("processing result not found")
                        .is_error(true)
                        .send(StatusCode::NOT_FOUND);
                }
                _ => {
                    return GenericResponse::builder()
                        .message("unable to get processing result")
                        .is_error(true)
                        .send(StatusCode::INTERNAL_SERVER_ERROR);
                }
            }
        }
    };

    let response_data = serde_json::json!({
        "result": processing_result,
    });

    GenericResponse::builder()
        .data(&response_data)
        .send(StatusCode::OK)
}
