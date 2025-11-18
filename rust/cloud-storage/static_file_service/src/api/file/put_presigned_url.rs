use std::str::FromStr;

use crate::api::context::AppState;
use crate::model::api::*;
use crate::service::dynamodb::model::MetadataObject;
use axum::extract::{Json, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::{Extension, response::Response};
use chrono::Utc;
use model::document::FileType;
use model::user::UserContext;
use uuid::Uuid;

#[utoipa::path(
  put,
  path = "/api/file",
  request_body = PutFileRequest,
  responses(
    (status = 200, body=PutFileResponse),
    (status = 401, body=String),
    (status = 500, body=String),
  ),
)]
#[tracing::instrument(skip(ctx, user), fields(user_id=user.user_id))]
pub async fn put_presigned_url(
    State(ctx): State<AppState>,
    user: Extension<UserContext>,
    Json(request): Json<PutFileRequest>,
) -> Result<Response, Response> {
    let content_type = if let Some(content_type) = request.content_type {
        Ok(content_type)
    } else {
        request
            .file_name
            .split(".")
            .last()
            .map(FileType::from_str)
            .and_then(Result::ok)
            .map(|file_type| file_type.mime_type().to_string())
            .ok_or_else(|| {
                (
                    StatusCode::UNSUPPORTED_MEDIA_TYPE,
                    "unknown or unsupported media type",
                )
                    .into_response()
            })
    }?;

    let id: String = Uuid::new_v4().to_string();
    let s3_key = format!("file/{}", id);
    let permalink = format!("{}/{}", ctx.config.service_url, s3_key);

    let owner_id = if !user.user_id.is_empty() {
        user.user_id.clone()
    } else {
        "nobody".to_string()
    };

    let metadata = MetadataObject {
        file_id: id.clone(),
        content_type: content_type.clone(),
        is_uploaded: false,
        last_accessed: Utc::now(),
        owner_id,
        extension_data: request.extension_data,
        file_name: request.file_name,
        s3_key: s3_key.clone(),
    };

    ctx.metadata_client
        .put_metadata(metadata)
        .await
        .map_err(|err| {
            tracing::error!(error=?err, "coult not create metadata");
            (StatusCode::INTERNAL_SERVER_ERROR, "internal server error").into_response()
        })?;

    let upload_url = ctx
        .storage_client
        .put_presigned_url(s3_key.clone(), content_type.clone())
        .await
        .map_err(|err| {
            tracing::error!(error=?err, "could not create presigned url");
            (StatusCode::INTERNAL_SERVER_ERROR, "internal server error").into_response()
        })?;

    Ok((
        StatusCode::OK,
        Json(PutFileResponse {
            id: id.clone(),
            upload_url,
            file_location: permalink,
        }),
    )
        .into_response())
}
