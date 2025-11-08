use axum::extract::Path;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use macro_db_client::dcs::get_document;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(serde::Deserialize)]
pub struct Params {
    pub document_id: String,
}

#[utoipa::path(
    post,
    path = "/internal/re_extract_document/{document_id}",
    params(
        ("document_id" = String, Path, description = "Id of the document to re-extract")
    ),
    responses(
        (status = 200, body=String),
        (status = 400, body=String),
        (status = 404, body=String),
        (status = 500, body=String),
    )
)]
pub async fn re_extract_document(
    State(sqs_client): State<Arc<sqs_client::SQS>>,
    State(config): State<Arc<crate::Config>>,
    State(db): State<PgPool>,
    Path(Params { document_id: id }): Path<Params>,
) -> Result<impl IntoResponse, impl IntoResponse> {
    let document = get_document::get_document(&db, id.as_str())
        .await
        .map_err(|e| {
            tracing::error!(error = %e, document_id = %id, "failed to get document");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to get document".to_string(),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                "could not find document id".to_string(),
            )
        })?;
    if document.file_type != "pdf" {
        return Err((StatusCode::BAD_REQUEST, "document is not a pdf".to_string()));
    }
    let version = document
        .document_version_id
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "no version id".to_string()))?;

    let document_location_key = format!("{}/{}/{}.pdf", document.owner, document.id, version);
    let chunk = (
        document.id,
        config.document_storage_bucket.clone(),
        document_location_key,
    );
    sqs_client
        .enqueue_documents_for_extraction(vec![chunk])
        .await
        .map_err(|err| {
            tracing::error!(error = %err, document_id = %id, "failed to enqueue document for extraction");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to enqueue extraction".to_string(),
            )
        })?;

    Ok((StatusCode::OK, "ok".to_string()))
}
