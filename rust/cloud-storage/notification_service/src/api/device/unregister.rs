use axum::{
    Extension, Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::response::{EmptyResponse, ErrorResponse};
use notification_db_client::device;

use crate::api::context::ApiContext;
use crate::model::device::DeviceRequest;
use model::user::UserContext;

/// Unregister a device from receiving push notifications.
#[utoipa::path(
      delete,
      operation_id = "unregister_device",
      path = "/device/unregister",
      request_body = DeviceRequest,
      responses(
          (status = 200, body=EmptyResponse),
          (status = 401, body=ErrorResponse),
          (status = 404, body=ErrorResponse),
          (status = 500, body=ErrorResponse),
      )
  )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    extract::Json(req): extract::Json<DeviceRequest>,
) -> Result<Response, Response> {
    let device_endpoint = device::delete_user_device_token(&ctx.db, &req.token, &req.device_type)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to delete device token");
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: "device not found",
                }),
            )
                .into_response()
        })?;

    ctx.sns_client
        .delete_endpoint(&device_endpoint)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to delete endpoint");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to unregister device",
                }),
            )
                .into_response()
        })?;

    Ok((StatusCode::OK, Json(EmptyResponse {})).into_response())
}
