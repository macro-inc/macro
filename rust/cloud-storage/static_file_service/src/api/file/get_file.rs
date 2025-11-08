use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use std::sync::Arc;

use crate::service::dynamodb::client::DynamodbClient;
use crate::service::s3::client::S3Client;

#[derive(serde::Deserialize)]
pub struct Params {
    pub file_id: String,
}

#[utoipa::path(
    get,
    path = "/api/file/{file_id}/presigned-url",
    params(
        ("file_id" = String, Path, description = "File ID")
    ),
    responses(
        (status = 200, body=String, description = "Presigned URL for the file"),
        (status = 404, body=String),
        (status = 500, body=String)
    )
)]
#[tracing::instrument(skip(metadata_client, storage_client))]
pub async fn handle_get_presigned_url(
    State(metadata_client): State<DynamodbClient>,
    State(storage_client): State<Arc<S3Client>>,
    Path(Params { file_id }): Path<Params>,
) -> Result<Response, Response> {
    // First get metadata to ensure file exists and is uploaded
    let metadata = metadata_client
        .get_metadata(file_id.as_str())
        .await
        .map_err(|err| {
            tracing::error!(error=?err, "error getting metadata");
            (StatusCode::INTERNAL_SERVER_ERROR, "internal server error").into_response()
        })?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "file not found").into_response())?;

    // Check if file is uploaded
    if !metadata.is_uploaded {
        return Err((StatusCode::NOT_FOUND, "file not yet uploaded").into_response());
    }

    // Get presigned URL for file
    let s3_key = format!("file/{}", file_id);
    let presigned_url = storage_client
        .get_presigned_url(s3_key)
        .await
        .map_err(|err| {
            tracing::error!(error=?err, "error getting presigned URL from S3");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to get presigned URL",
            )
                .into_response()
        })?;

    Ok((StatusCode::OK, presigned_url).into_response())
}
