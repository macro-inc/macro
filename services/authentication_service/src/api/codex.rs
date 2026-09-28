//! User-authenticated Codex connection endpoints; policy belongs to codex_connection.

use crate::api::context::{ApiContext, AuthorizationService};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use codex_connection::domain::{ConnectionError, ConnectionStatus, LoginStatus};
use macro_authorization::{MacroAuthorizationExtractor, UserOnly};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

type User = MacroAuthorizationExtractor<AuthorizationService, UserOnly>;

/// Safe connection metadata; no secret or masked token is returned.
#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CodexConnectionStatus {
    /// Whether the user has completed provider authorization.
    pub connected: bool,
    /// Reserved until provider-verified email metadata is available.
    pub email: Option<String>,
    /// Connected provider account identifier.
    pub account_id: Option<String>,
    /// Explicitly selected remote environment.
    pub environment_id: Option<String>,
}
impl From<ConnectionStatus> for CodexConnectionStatus {
    fn from(status: ConnectionStatus) -> Self {
        Self {
            connected: status.connected,
            email: None,
            account_id: status.account_id,
            environment_id: status.environment_id,
        }
    }
}
/// Expiring browser authorization instructions.
#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CodexLoginStart {
    /// Owner-bound attempt UUID.
    pub attempt_id: Uuid,
    /// Official provider verification URL.
    pub verification_url: String,
    /// Short expiring user code, not an API credential.
    pub user_code: String,
    /// UTC attempt deadline.
    pub expires_at: chrono::DateTime<chrono::Utc>,
    /// Minimum browser polling interval.
    pub poll_interval_seconds: u64,
}
/// Device authorization state visible to its initiating user.
#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CodexLoginState {
    /// Awaiting user authorization.
    Pending,
    /// Credentials were durably stored.
    Connected,
    /// Authorization deadline passed.
    Expired,
    /// Provider exchange failed; begin a new attempt.
    Failed,
}
/// Outcome of polling one attempt.
#[derive(Serialize, Deserialize, ToSchema)]
pub struct CodexLoginPoll {
    /// Current attempt state.
    pub status: CodexLoginState,
}
/// A cloud environment visible to the connected provider account.
#[derive(Serialize, Deserialize, ToSchema)]
pub struct CodexEnvironment {
    /// Provider environment identity.
    pub id: String,
    /// Human-readable provider label.
    pub label: Option<String>,
    /// Ordered safe repository identities from Codex.
    pub repositories: Vec<CodexEnvironmentRepository>,
}
/// Safe repository metadata available to the connected Codex account.
#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CodexEnvironmentRepository {
    /// Owner/repository identity.
    pub full_name: String,
    /// Credential-free HTTPS clone URL.
    pub clone_url: String,
    /// Provider default branch.
    pub default_branch: String,
}
/// Explicit remote environment for future Codex sessions.
#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodexConfigRequest {
    /// An environment currently visible to this account.
    pub environment_id: String,
}

pub enum ApiError {
    Connection(ConnectionError),
    Unavailable,
}
impl From<ConnectionError> for ApiError {
    fn from(error: ConnectionError) -> Self {
        Self::Connection(error)
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let error = match self {
            Self::Unavailable => {
                return (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(model::response::ErrorResponse {
                        message: "Codex connection is unavailable in this deployment".into(),
                    }),
                )
                    .into_response();
            }
            Self::Connection(error) => error,
        };
        let code = match error {
            ConnectionError::InvalidInput => StatusCode::BAD_REQUEST,
            ConnectionError::NotFound => StatusCode::NOT_FOUND,
            ConnectionError::NotConnected
            | ConnectionError::AlreadyConnected
            | ConnectionError::AccountChanged => StatusCode::CONFLICT,
            ConnectionError::Provider => StatusCode::BAD_GATEWAY,
            ConnectionError::Storage | ConnectionError::Encryption => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        (
            code,
            Json(model::response::ErrorResponse {
                message: error.to_string().into(),
            }),
        )
            .into_response()
    }
}

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/", get(status).delete(disconnect))
        .route("/login", post(start_login))
        .route("/login/{attempt_id}", get(poll_login).delete(cancel_login))
        .route("/environments", get(environments))
        .route("/config", put(configure))
}

#[utoipa::path(get, path = "/codex", operation_id = "get_codex_connection", responses((status = 200, body = CodexConnectionStatus)))]
pub async fn status(
    State(ctx): State<ApiContext>,
    user: User,
) -> Result<Json<CodexConnectionStatus>, ApiError> {
    Ok(Json(
        ctx.codex_connection
            .as_ref()
            .ok_or(ApiError::Unavailable)?
            .status(user.authorization.macro_user_id.as_ref())
            .await?
            .into(),
    ))
}
#[utoipa::path(post, path = "/codex/login", operation_id = "start_codex_login", responses((status = 200, body = CodexLoginStart)))]
pub async fn start_login(
    State(ctx): State<ApiContext>,
    user: User,
) -> Result<Json<CodexLoginStart>, ApiError> {
    let started = ctx
        .codex_connection
        .as_ref()
        .ok_or(ApiError::Unavailable)?
        .start_login(user.authorization.macro_user_id.as_ref())
        .await?;
    Ok(Json(CodexLoginStart {
        attempt_id: started.attempt_id,
        verification_url: started.verification_url,
        user_code: started.user_code,
        expires_at: started.expires_at,
        poll_interval_seconds: started.poll_interval_seconds,
    }))
}
#[utoipa::path(get, path = "/codex/login/{attempt_id}", operation_id = "poll_codex_login", params(("attempt_id" = Uuid, Path)), responses((status = 200, body = CodexLoginPoll)))]
pub async fn poll_login(
    State(ctx): State<ApiContext>,
    user: User,
    Path(id): Path<Uuid>,
) -> Result<Json<CodexLoginPoll>, ApiError> {
    let status = ctx
        .codex_connection
        .as_ref()
        .ok_or(ApiError::Unavailable)?
        .poll_login(user.authorization.macro_user_id.as_ref(), id)
        .await?;
    Ok(Json(CodexLoginPoll {
        status: match status {
            LoginStatus::Pending => CodexLoginState::Pending,
            LoginStatus::Connected => CodexLoginState::Connected,
            LoginStatus::Expired => CodexLoginState::Expired,
            LoginStatus::Failed => CodexLoginState::Failed,
        },
    }))
}
#[utoipa::path(delete, path = "/codex/login/{attempt_id}", operation_id = "cancel_codex_login", params(("attempt_id" = Uuid, Path)), responses((status = 204)))]
pub async fn cancel_login(
    State(ctx): State<ApiContext>,
    user: User,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    ctx.codex_connection
        .as_ref()
        .ok_or(ApiError::Unavailable)?
        .cancel_login(user.authorization.macro_user_id.as_ref(), id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
#[utoipa::path(delete, path = "/codex", operation_id = "disconnect_codex", responses((status = 204)))]
pub async fn disconnect(State(ctx): State<ApiContext>, user: User) -> Result<StatusCode, ApiError> {
    ctx.codex_connection
        .as_ref()
        .ok_or(ApiError::Unavailable)?
        .disconnect(user.authorization.macro_user_id.as_ref())
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
#[utoipa::path(get, path = "/codex/environments", operation_id = "list_codex_environments", responses((status = 200, body = Vec<CodexEnvironment>)))]
pub async fn environments(
    State(ctx): State<ApiContext>,
    user: User,
) -> Result<Json<Vec<CodexEnvironment>>, ApiError> {
    Ok(Json(
        ctx.codex_connection
            .as_ref()
            .ok_or(ApiError::Unavailable)?
            .environments(user.authorization.macro_user_id.as_ref())
            .await?
            .into_iter()
            .map(|environment| CodexEnvironment {
                id: environment.id,
                label: environment.label,
                repositories: environment
                    .repositories
                    .into_iter()
                    .map(|repository| CodexEnvironmentRepository {
                        full_name: repository.full_name,
                        clone_url: repository.clone_url,
                        default_branch: repository.default_branch,
                    })
                    .collect(),
            })
            .collect(),
    ))
}
#[utoipa::path(put, path = "/codex/config", operation_id = "configure_codex", request_body = CodexConfigRequest, responses((status = 200, body = CodexConnectionStatus)))]
pub async fn configure(
    State(ctx): State<ApiContext>,
    user: User,
    Json(request): Json<CodexConfigRequest>,
) -> Result<Json<CodexConnectionStatus>, ApiError> {
    Ok(Json(
        ctx.codex_connection
            .as_ref()
            .ok_or(ApiError::Unavailable)?
            .configure(
                user.authorization.macro_user_id.as_ref(),
                &request.environment_id,
            )
            .await?
            .into(),
    ))
}

#[cfg(test)]
mod test;
