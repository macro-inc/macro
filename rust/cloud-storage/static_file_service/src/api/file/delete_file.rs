use crate::service::dynamodb::client::DynamodbClient;
use crate::service::dynamodb::model::DeleteError;
use crate::service::s3::client::S3Client;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::{Extension, response::Response};
use model::user::UserContext;
use std::sync::Arc;

#[derive(serde::Deserialize)]
pub struct Params {
    pub file_id: String,
}

#[utoipa::path(
    delete,
    path = "/api/file/{file_id}",
    params(
        ("file_id" = String, Path, description = "File ID")
    ),
    responses(
      (status = 200, body = String),
      (status = 401, body = String),
      (status = 403, body = String),
      (status = 404, body = String),
    )
  )
]
#[tracing::instrument(skip(metadata_client, storage_client, usr), fields(user_id = usr.user_id))]
pub async fn handle_delete_file(
    State(metadata_client): State<DynamodbClient>,
    State(storage_client): State<Arc<S3Client>>,
    usr: Extension<UserContext>,
    Path(Params { file_id }): Path<Params>,
) -> Result<Response, Response> {
    let metadata = metadata_client
        .get_metadata(file_id.as_str())
        .await
        .map_err(|err| {
            tracing::error!(error=?err, "failed to delete file");
            (StatusCode::INTERNAL_SERVER_ERROR, "internal server error").into_response()
        })?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "not found").into_response())?;

    // TODO handle in middleware
    if metadata.owner_id != usr.user_id {
        tracing::warn!("delete requested by non-owner");
        return Err((StatusCode::FORBIDDEN, "access denied").into_response());
    }

    storage_client
        .hard_delete_object(metadata.s3_key)
        .await
        .map_err(|e| {
            tracing::error!(error =? e, "failed to delete s3 object");
            (StatusCode::INTERNAL_SERVER_ERROR, "internal server error").into_response()
        })?;

    metadata_client
        .delete_metadata(file_id.as_str())
        .await
        .map_err(|e| match e {
            DeleteError::NotFound(not_found) => {
                tracing::warn!(error=?not_found, "metadata not found");
                (StatusCode::NOT_FOUND, "not found").into_response()
            }
            DeleteError::Other(err) => {
                tracing::error!(error = err, "error deleting metadata");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal server error").into_response()
            }
        })?;

    Ok((StatusCode::OK, "Ok".to_string()).into_response())
}
