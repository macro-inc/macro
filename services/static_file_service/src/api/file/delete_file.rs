use crate::api::context::AuthorizationService;
use crate::service::dynamodb::client::DynamodbClient;
use crate::service::dynamodb::model::DeleteError;
use crate::service::s3::client::S3Client;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::response::Response;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal, UserOrInternalCaller};
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
#[tracing::instrument(
    skip(metadata_client, storage_client, user),
    fields(actor = %user.acting_entity())
)]
pub async fn handle_delete_file(
    State(metadata_client): State<DynamodbClient>,
    State(storage_client): State<Arc<S3Client>>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
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

    // Skip owner check for internal requests
    let is_internal = user.authorization.caller == UserOrInternalCaller::Internal;
    if !is_internal && metadata.owner_id != user.authorization.user.macro_user_id.as_ref() {
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

    let scaled_prefix = format!("file/{file_id}/");
    storage_client
        .delete_objects_by_prefix(&scaled_prefix)
        .await
        .inspect_err(|e| tracing::warn!(error=?e, "failed to delete scaled variants"))
        .ok();

    Ok((StatusCode::OK, "Ok".to_string()).into_response())
}
