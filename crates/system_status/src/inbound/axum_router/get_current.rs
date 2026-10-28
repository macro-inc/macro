//! Handler for `GET /system-status`.

use axum::{Json, extract::State};
use macro_authorization::MacroAuthorizationService;

use super::SystemStatusRouterState;
use crate::domain::models::{CurrentSystemStatus, SystemStatusError};
use crate::domain::ports::SystemStatusService;

/// The status every user sees. Public: the banner shows wherever the app
/// runs, signed in or not.
#[utoipa::path(
    tag = "system_status",
    get,
    path = "/system-status",
    operation_id = "get_system_status",
    responses(
        (status = 200, body = CurrentSystemStatus),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: SystemStatusService, Auth: MacroAuthorizationService>(
    State(state): State<SystemStatusRouterState<T, Auth>>,
) -> Result<Json<CurrentSystemStatus>, SystemStatusError> {
    Ok(Json(state.service.current_status().await?))
}
