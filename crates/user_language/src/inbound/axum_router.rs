//! Axum router for the user language endpoints.

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
use model_user::UserLanguage;

use crate::domain::{models::UserLanguageError, ports::UserLanguageService};

/// Router state for the user language endpoints.
pub struct UserLanguageRouterState<S, Auth> {
    service: Arc<S>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> Clone for UserLanguageRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S: UserLanguageService, Auth> UserLanguageRouterState<S, Auth> {
    /// Create router state from a shared service and authorization state.
    pub fn new(service: Arc<S>, authorization_state: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service,
            authorization_state,
        }
    }
}

impl<S, Auth> FromRef<UserLanguageRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &UserLanguageRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the user language router.
///
/// Routes:
/// - `GET /language` — the caller's language.
/// - `PUT /language` — set or clear the caller's language.
pub fn user_language_router<S, Auth, T>(state: UserLanguageRouterState<S, Auth>) -> Router<T>
where
    S: UserLanguageService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/language",
            get(get_user_language_handler::<S, Auth>).put(put_user_language_handler::<S, Auth>),
        )
        .with_state(state)
}

/// Get the caller's interface language.
#[utoipa::path(
    get,
    tag = "user",
    operation_id = "get_user_language",
    path = "/user/language",
    responses(
        (status = 200, body = UserLanguage),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_user_language_handler<S, Auth>(
    State(state): State<UserLanguageRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<UserLanguage>, UserLanguageError>
where
    S: UserLanguageService,
    Auth: MacroAuthorizationService,
{
    let language = state
        .service
        .get_language(&user.authorization.user.macro_user_id)
        .await?;
    Ok(Json(UserLanguage { language }))
}

/// Set the caller's interface language, or clear it to follow their team.
#[utoipa::path(
    put,
    tag = "user",
    operation_id = "put_user_language",
    path = "/user/language",
    request_body = UserLanguage,
    responses(
        (status = 204, description = "Language updated"),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn put_user_language_handler<S, Auth>(
    State(state): State<UserLanguageRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(body): Json<UserLanguage>,
) -> Result<StatusCode, UserLanguageError>
where
    S: UserLanguageService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .set_language(&user.authorization.user.macro_user_id, body.language)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

impl IntoResponse for UserLanguageError {
    fn into_response(self) -> axum::response::Response {
        let (status_code, message) = match &self {
            UserLanguageError::UserNotFound => (StatusCode::NOT_FOUND, self.to_string()),
            UserLanguageError::Internal(_) => {
                tracing::error!(error=?self, "user language internal server error");
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
