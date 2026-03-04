//! HTTP handlers for device registration.

use axum::{
    Json, Router,
    extract::State,
    routing::{delete, post},
};
use model_error_response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;
use reqwest::StatusCode;

use crate::domain::models::device::DeviceRequest;
use crate::domain::service::NotificationReader;
use crate::inbound::http::NotificationRouterState;

/// Construct the device registration router.
pub fn device_router<S: NotificationReader>() -> Router<NotificationRouterState<S>> {
    Router::new()
        .route("/register", post(register_device::<S>))
        .route("/unregister", delete(unregister_device::<S>))
}

/// Register a device for push notifications.
#[tracing::instrument(skip(state, macro_user, req), fields(user_id=?macro_user.macro_user_id))]
async fn register_device<S: NotificationReader>(
    State(state): State<NotificationRouterState<S>>,
    macro_user: MacroUserExtractor,
    Json(req): Json<DeviceRequest>,
) -> Result<Json<()>, (StatusCode, Json<ErrorResponse<'static>>)> {
    state
        .inner
        .register_device(macro_user.macro_user_id, &req.token, &req.device_type)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to register device");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to register device",
                }),
            )
        })?;

    Ok(Json(()))
}

/// Unregister a device from push notifications.
#[tracing::instrument(skip(state, _macro_user, req))]
async fn unregister_device<S: NotificationReader>(
    State(state): State<NotificationRouterState<S>>,
    _macro_user: MacroUserExtractor,
    Json(req): Json<DeviceRequest>,
) -> Result<Json<()>, (StatusCode, Json<ErrorResponse<'static>>)> {
    state
        .inner
        .unregister_device(&req.token, &req.device_type)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to unregister device");
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: "device not found",
                }),
            )
        })?;

    Ok(Json(()))
}
