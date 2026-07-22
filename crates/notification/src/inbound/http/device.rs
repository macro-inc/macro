//! HTTP handlers for device registration.

use axum::{
    Json, Router,
    extract::State,
    routing::{delete, post},
};
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};
use model_error_response::ErrorResponse;
use reqwest::StatusCode;

use crate::domain::models::device::DeviceRequest;
use crate::domain::service::NotificationReader;
use crate::inbound::http::NotificationRouterState;

/// Construct the device registration router.
pub fn device_router<S, Auth>() -> Router<NotificationRouterState<S, Auth>>
where
    S: NotificationReader,
    Auth: MacroAuthorizationService,
{
    Router::new()
        .route("/register", post(register_device::<S, Auth>))
        .route("/unregister", delete(unregister_device::<S, Auth>))
}

/// Register a device for push notifications.
#[tracing::instrument(skip(state, user, req))]
async fn register_device<S: NotificationReader, Auth: MacroAuthorizationService>(
    State(state): State<NotificationRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(req): Json<DeviceRequest>,
) -> Result<Json<()>, (StatusCode, Json<ErrorResponse<'static>>)> {
    state
        .inner
        .register_device(
            user.authorization.user.macro_user_id,
            &req.token,
            &req.device_type,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to register device");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to register device".into(),
                }),
            )
        })?;

    Ok(Json(()))
}

/// Unregister a device from push notifications.
#[tracing::instrument(skip(state, _macro_user, req))]
async fn unregister_device<S: NotificationReader, Auth: MacroAuthorizationService>(
    State(state): State<NotificationRouterState<S, Auth>>,
    _macro_user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
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
                    message: "device not found".into(),
                }),
            )
        })?;

    Ok(Json(()))
}
