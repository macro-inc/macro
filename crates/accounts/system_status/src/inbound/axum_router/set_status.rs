//! Handler for `POST /system-status`.

use axum::{Json, extract::State};
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};

use super::SystemStatusRouterState;
use crate::domain::models::{StatusUpdate, SystemStatus, SystemStatusError};
use crate::domain::ports::SystemStatusService;

/// Sets the status every user sees and pushes it to every open app. Macro
/// staff only.
///
/// Authenticate with a Macro session, or from a script with a personal API
/// key (Settings → API keys) in the `x-macro-user-api-key` header. The body
/// is the new status:
///
/// - `{"status": "operational"}` clears the banner. It takes no message.
/// - `{"status": "degraded", "message": "Search is slow to update."}`
/// - `{"status": "major_outage", "message": "Macro is unavailable. We're on it."}`
///
/// Messages are trimmed and must be 1–500 characters. Every call is kept in
/// the history, even when it repeats the current status.
#[utoipa::path(
    tag = "system_status",
    post,
    path = "/system-status",
    operation_id = "set_system_status",
    request_body = SystemStatus,
    responses(
        (status = 200, body = StatusUpdate),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 403, body = model_error_response::ErrorResponse),
        (status = 422, description = "The body is not a valid status"),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: SystemStatusService, Auth: MacroAuthorizationService>(
    State(state): State<SystemStatusRouterState<T, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(status): Json<SystemStatus>,
) -> Result<Json<StatusUpdate>, SystemStatusError> {
    let caller = &authorization.authorization.user.macro_user_id;
    Ok(Json(state.service.set_status(caller, status).await?))
}
