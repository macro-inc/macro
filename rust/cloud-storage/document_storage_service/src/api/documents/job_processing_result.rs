use crate::model::response::documents::get::GetDocumentProcessingResultResponse;
use axum::{
    Extension,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use macro_db_client::document::get_document_process_content_from_job_id;
use model::response::GenericResponse;
use model::{response::GenericErrorResponse, user::UserContext};
use sqlx::PgPool;

#[derive(serde::Deserialize)]
pub struct Params {
    pub document_id: String,
    pub job_id: String,
}

/// Fetches the document processing result for a given document id and job id
#[utoipa::path(
        tag = "document",
        get,
        path = "/documents/{document_id}/processing/{job_id}",
        params(
            ("document_id" = String, Path, description = "Document ID"),
            ("job_id" = String, Path, description = "Job ID")
        ),
        responses(
            (status = 200, body=GetDocumentProcessingResultResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(db, user_context), fields(user_id=?user_context.user_id))]
pub async fn job_processing_result_handler(
    State(db): State<PgPool>,
    user_context: Extension<UserContext>,
    Path(Params {
        document_id,
        job_id,
    }): Path<Params>,
) -> impl IntoResponse {
    let processing_result =
        match get_document_process_content_from_job_id(&db, job_id.as_str(), document_id.as_str())
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
