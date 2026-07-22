use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use macro_authorization::MacroAuthorizationExtractor;
use std::sync::Arc;

use crate::api::context::AuthorizationService;
use crate::service::dynamodb::client::DynamodbClient;
use crate::service::s3::client::S3Client;

use super::required_user;

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
        (status = 401, body=String),
        (status = 404, body=String),
        (status = 500, body=String)
    )
)]
#[tracing::instrument(
    skip(metadata_client, storage_client, user),
    fields(user_id = tracing::field::Empty)
)]
pub async fn handle_get_presigned_url(
    State(metadata_client): State<DynamodbClient>,
    State(storage_client): State<Arc<S3Client>>,
    user: MacroAuthorizationExtractor<AuthorizationService>,
    Path(Params { file_id }): Path<Params>,
) -> Result<Response, Response> {
    let acting_user = required_user(&user.authorization);
    tracing::Span::current().record(
        "user_id",
        tracing::field::display(&acting_user.macro_user_id),
    );

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

    let s3_key = s3_key::StaticFileKey::new(&file_id).to_key();
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
