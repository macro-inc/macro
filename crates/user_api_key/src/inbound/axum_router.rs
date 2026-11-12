//! Axum router for user API key endpoints.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use macro_authorization::{
    AccountHolderOrInternal, MacroAuthorizationExtractor, MacroAuthorizationService,
    MacroAuthorizationRejection, MacroAuthorizationState, refuse_agent_run,
};
use model_error_response::ErrorResponse;
use serde::{Deserialize, Serialize};

use crate::domain::{
    models::{CreatedUserApiKey, UserApiKeyError, UserApiKeyId, UserApiKeyInfo},
    ports::UserApiKeyService,
};

#[cfg(test)]
mod test;

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
/// - `GET /` — list the caller's keys as id, name, and created_at.
/// - `DELETE /{id}` — delete one of the caller's keys by opaque id.
pub fn user_api_key_router<S, Auth, T>(state: UserApiKeyRouterState<S, Auth>) -> Router<T>
where
    S: UserApiKeyService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route("/", post(create_user_api_key_handler::<S, Auth>))
        .route("/", get(list_user_api_keys_handler::<S, Auth>))
        .route("/{id}", delete(delete_user_api_key_handler::<S, Auth>))
        .with_state(state)
}

/// Request body for minting a key.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateUserApiKeyRequest {
    /// User-facing name for the key.
    pub name: String,
}

/// The caller's API keys as id, name, and created_at.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UserApiKeysList {
    /// The caller's keys. Never includes the raw secret or hash.
    pub keys: Vec<UserApiKeyInfo>,
}

/// Path params for deleting a key.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct DeleteUserApiKeyParams {
    /// Opaque key identifier.
    pub id: UserApiKeyId,
}

/// Why an agent's program may not mint an API key: the key outlives the run
/// and its secret would be in the program's hands.
pub const PROGRAM_API_KEY_REFUSAL: &str =
    "An agent's program cannot create API keys. Ask the user to create one in Macro's settings.";

/// Why a key was not minted.
#[derive(Debug, thiserror::Error)]
pub enum CreateUserApiKeyError {
    /// An agent's program asked for it.
    #[error(transparent)]
    Refused(#[from] MacroAuthorizationRejection),
    /// The key service refused or failed.
    #[error(transparent)]
    Key(#[from] UserApiKeyError),
}

impl IntoResponse for CreateUserApiKeyError {
    fn into_response(self) -> Response {
        match self {
            Self::Refused(rejection) => rejection.into_response(),
            Self::Key(error) => error.into_response(),
        }
    }
}

/// Mint a new API key for the caller. An agent's program is refused (403).
#[utoipa::path(
    post,
    tag = "user-api-keys",
    operation_id = "create_user_api_key",
    path = "/user-api-keys",
    request_body = CreateUserApiKeyRequest,
    responses(
        (status = 201, body = CreatedUserApiKey),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn create_user_api_key_handler<S, Auth>(
    State(state): State<UserApiKeyRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, AccountHolderOrInternal>,
    headers: HeaderMap,
    Json(body): Json<CreateUserApiKeyRequest>,
) -> Result<(StatusCode, Json<CreatedUserApiKey>), CreateUserApiKeyError>
where
    S: UserApiKeyService,
    Auth: MacroAuthorizationService,
{
    refuse_agent_run(
        user.authorization.user.agent_id.is_some(),
        &headers,
        PROGRAM_API_KEY_REFUSAL,
    )?;
    let created = state
        .service
        .create_key(&user.authorization.user.macro_user_id, &body.name)
        .await?;
    Ok((StatusCode::CREATED, Json(created)))
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
    user: MacroAuthorizationExtractor<Auth, AccountHolderOrInternal>,
) -> Result<Json<UserApiKeysList>, UserApiKeyError>
where
    S: UserApiKeyService,
    Auth: MacroAuthorizationService,
{
    let keys = state
        .service
        .list_keys(&user.authorization.user.macro_user_id)
        .await?;
    Ok(Json(UserApiKeysList { keys }))
}

/// Delete one of the caller's API keys.
#[utoipa::path(
    delete,
    tag = "user-api-keys",
    operation_id = "delete_user_api_key",
    path = "/user-api-keys/{id}",
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
    user: MacroAuthorizationExtractor<Auth, AccountHolderOrInternal>,
    Path(params): Path<DeleteUserApiKeyParams>,
) -> Result<StatusCode, UserApiKeyError>
where
    S: UserApiKeyService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .delete_key(&user.authorization.user.macro_user_id, params.id)
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
