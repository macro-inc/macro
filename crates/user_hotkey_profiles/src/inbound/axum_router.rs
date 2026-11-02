//! Axum router for the user hotkey profiles endpoints.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use model_error_response::ErrorResponse;

use crate::domain::{
    models::{UserHotkeyProfiles, UserHotkeyProfilesError},
    ports::UserHotkeyProfilesService,
};

/// Router state for the user hotkey profiles endpoints.
pub struct UserHotkeyProfilesRouterState<S, Auth> {
    service: Arc<S>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> Clone for UserHotkeyProfilesRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S: UserHotkeyProfilesService, Auth> UserHotkeyProfilesRouterState<S, Auth> {
    /// Create router state from a shared service and authorization state.
    pub fn new(service: Arc<S>, authorization_state: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service,
            authorization_state,
        }
    }
}

impl<S, Auth> FromRef<UserHotkeyProfilesRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &UserHotkeyProfilesRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the user hotkey profiles router.
///
/// Routes:
/// - `GET /hotkey-profiles` — the caller's profiles.
/// - `PUT /hotkey-profiles` — replace the caller's profiles.
pub fn user_hotkey_profiles_router<S, Auth, T>(
    state: UserHotkeyProfilesRouterState<S, Auth>,
) -> Router<T>
where
    S: UserHotkeyProfilesService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/hotkey-profiles",
            get(get_user_hotkey_profiles_handler::<S, Auth>)
                .put(put_user_hotkey_profiles_handler::<S, Auth>),
        )
        .with_state(state)
}

/// Get the caller's keyboard shortcut layouts.
#[utoipa::path(
    get,
    tag = "user",
    operation_id = "get_user_hotkey_profiles",
    path = "/user/hotkey-profiles",
    responses(
        (status = 200, body = UserHotkeyProfiles),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_user_hotkey_profiles_handler<S, Auth>(
    State(state): State<UserHotkeyProfilesRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<UserHotkeyProfiles>, UserHotkeyProfilesError>
where
    S: UserHotkeyProfilesService,
    Auth: MacroAuthorizationService,
{
    let profiles = state
        .service
        .get_profiles(&user.authorization.user.macro_user_id)
        .await?;
    Ok(Json(profiles))
}

/// Replace the caller's keyboard shortcut layouts. A `null` layout keeps
/// Macro's own shortcuts in that area.
#[utoipa::path(
    put,
    tag = "user",
    operation_id = "put_user_hotkey_profiles",
    path = "/user/hotkey-profiles",
    request_body = UserHotkeyProfiles,
    responses(
        (status = 200, body = UserHotkeyProfiles),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn put_user_hotkey_profiles_handler<S, Auth>(
    State(state): State<UserHotkeyProfilesRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(body): Json<UserHotkeyProfiles>,
) -> Result<Json<UserHotkeyProfiles>, UserHotkeyProfilesError>
where
    S: UserHotkeyProfilesService,
    Auth: MacroAuthorizationService,
{
    let profiles = state
        .service
        .set_profiles(&user.authorization.user.macro_user_id, body)
        .await?;
    Ok(Json(profiles))
}

impl IntoResponse for UserHotkeyProfilesError {
    fn into_response(self) -> axum::response::Response {
        let (status_code, message) = match &self {
            UserHotkeyProfilesError::UserNotFound => (StatusCode::NOT_FOUND, self.to_string()),
            UserHotkeyProfilesError::Internal(_) => {
                tracing::error!(error=?self, "user hotkey profiles internal server error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal server error".to_string(),
                )
            }
        };
        (
            status_code,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}
