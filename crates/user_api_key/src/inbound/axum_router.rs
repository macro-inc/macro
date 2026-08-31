//! Axum router for user API key endpoints.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use model_error_response::ErrorResponse;
use serde::{Deserialize, Serialize};

use crate::domain::{
    models::{UserApiKey, UserApiKeyError},
    ports::UserApiKeyService,
};

/// Router state for user API key endpoints.
pub struct UserApiKeyRouterState<S, Auth> {
    service: Arc<S>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> Clone for UserApiKeyRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Auth> UserApiKeyRouterState<S, Auth>
where
    S: UserApiKeyService,
{
    /// Create router state from a shared service and authorization state.
    pub fn new(service: Arc<S>, authorization_state: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service,
            authorization_state,
        }
    }
}

impl<S, Auth> FromRef<UserApiKeyRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &UserApiKeyRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the user API key router.
///
/// Routes:
/// - `POST /` — mint a key for the caller.
/// - `GET /` — list the caller's keys.
/// - `DELETE /{key}` — delete one of the caller's keys.
pub fn user_api_key_router<S, Auth, T>(state: UserApiKeyRouterState<S, Auth>) -> Router<T>
where
    S: UserApiKeyService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route("/", post(create_user_api_key_handler::<S, Auth>))
        .route("/", get(list_user_api_keys_handler::<S, Auth>))
        .route("/{key}", delete(delete_user_api_key_handler::<S, Auth>))
        .with_state(state)
}

/// Response body for minting a key.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateUserApiKeyResponse {
    /// The newly minted secret. Shown only on create.
    pub key: String,
}

/// The caller's API keys.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UserApiKeysList {
    /// The caller's keys.
    pub keys: Vec<String>,
}

/// Path params for deleting a key.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct DeleteUserApiKeyParams {
    /// The full key value.
    pub key: String,
}

/// Mint a new API key for the caller.
#[utoipa::path(
    post,
    tag = "user-api-keys",
    operation_id = "create_user_api_key",
    path = "/user-api-keys",
    responses(
        (status = 201, body = CreateUserApiKeyResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn create_user_api_key_handler<S, Auth>(
    State(state): State<UserApiKeyRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<(StatusCode, Json<CreateUserApiKeyResponse>), UserApiKeyError>
where
    S: UserApiKeyService,
    Auth: MacroAuthorizationService,
{
    let key = state
        .service
        .create_key(&user.authorization.user.macro_user_id)
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(CreateUserApiKeyResponse {
            key: key.expose().to_string(),
        }),
    ))
}

/// List the caller's API keys.
#[utoipa::path(
    get,
    tag = "user-api-keys",
    operation_id = "list_user_api_keys",
    path = "/user-api-keys",
    responses(
        (status = 200, body = UserApiKeysList),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn list_user_api_keys_handler<S, Auth>(
    State(state): State<UserApiKeyRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<UserApiKeysList>, UserApiKeyError>
where
    S: UserApiKeyService,
    Auth: MacroAuthorizationService,
{
    let keys = state
        .service
        .list_keys(&user.authorization.user.macro_user_id)
        .await?;
    Ok(Json(UserApiKeysList {
        keys: keys.iter().map(|key| key.expose().to_string()).collect(),
    }))
}

/// Delete one of the caller's API keys.
#[utoipa::path(
    delete,
    tag = "user-api-keys",
    operation_id = "delete_user_api_key",
    path = "/user-api-keys/{key}",
    params(DeleteUserApiKeyParams),
    responses(
        (status = 204, description = "API key deleted"),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn delete_user_api_key_handler<S, Auth>(
    State(state): State<UserApiKeyRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(params): Path<DeleteUserApiKeyParams>,
) -> Result<StatusCode, UserApiKeyError>
where
    S: UserApiKeyService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .delete_key(
            &user.authorization.user.macro_user_id,
            &UserApiKey::from_raw(params.key),
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

impl IntoResponse for UserApiKeyError {
    fn into_response(self) -> axum::response::Response {
        let status_code = match &self {
            UserApiKeyError::NotFound => StatusCode::NOT_FOUND,
            UserApiKeyError::BadRequest(_) => StatusCode::BAD_REQUEST,
            UserApiKeyError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let message = match &self {
            UserApiKeyError::Internal(_) => {
                tracing::error!(error=?self, "user api key internal server error");
                "internal server error".to_string()
            }
            error => error.to_string(),
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
