//! A team's own Anthropic and OpenAI API keys for in-app AI chat.
//!
//! Members see which providers have a key; admins and the owner register or
//! remove one. The team is the caller's own team, resolved by the extractor,
//! never a path or body value. Like the Cursor key, a registered key is never
//! readable again through this API.

use axum::{
    Json, Router,
    extract::{Path, State},
    routing::{get, put},
};
use entity_access::{
    domain::models::{AdminTeamRole, MemberTeamRole},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use team_provider_keys::domain::{ModelProvider, TeamProviderKeyError, TeamProviderKeyStatus};
use utoipa::ToSchema;

use crate::api::context::{ApiContext, AuthorizationService, EntityAccessServiceType};

type MemberTeam =
    MacroUserTeamExtractorV2<MemberTeamRole, EntityAccessServiceType, AuthorizationService>;
type AdminTeam =
    MacroUserTeamExtractorV2<AdminTeamRole, EntityAccessServiceType, AuthorizationService>;

/// Routes for the team settings' AI API keys section.
pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/", get(list_handler))
        .route("/{provider}", put(put_handler).delete(delete_handler))
}

/// A provider a team can bring its own key for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum TeamAiProvider {
    /// Anthropic (`sk-ant-…` keys).
    Anthropic,
    /// OpenAI (`sk-…` keys).
    Openai,
}

impl From<TeamAiProvider> for ModelProvider {
    fn from(provider: TeamAiProvider) -> Self {
        match provider {
            TeamAiProvider::Anthropic => Self::Anthropic,
            TeamAiProvider::Openai => Self::OpenAi,
        }
    }
}

impl From<ModelProvider> for TeamAiProvider {
    fn from(provider: ModelProvider) -> Self {
        match provider {
            ModelProvider::Anthropic => Self::Anthropic,
            ModelProvider::OpenAi => Self::Openai,
        }
    }
}

/// One provider the team has a key for. Never includes the key.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamAiApiKey {
    /// The provider.
    pub provider: TeamAiProvider,
    /// When the key was last replaced.
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl From<TeamProviderKeyStatus> for TeamAiApiKey {
    fn from(status: TeamProviderKeyStatus) -> Self {
        Self {
            provider: status.provider.into(),
            updated_at: status.updated_at,
        }
    }
}

/// The providers the caller's team has a key for.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamAiApiKeys {
    /// One entry per provider with a key.
    pub keys: Vec<TeamAiApiKey>,
}

impl From<Vec<TeamProviderKeyStatus>> for TeamAiApiKeys {
    fn from(keys: Vec<TeamProviderKeyStatus>) -> Self {
        Self {
            keys: keys.into_iter().map(Into::into).collect(),
        }
    }
}

/// The key an admin pasted.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PutTeamAiApiKeyRequest {
    /// An Anthropic (`sk-ant-…`) or OpenAI (`sk-…`) API key.
    pub api_key: String,
}

/// Why a team key request failed.
#[derive(Debug, thiserror::Error)]
pub enum TeamAiApiKeyError {
    /// The value is not a key for the provider.
    #[error("value does not look like an API key for this provider")]
    MalformedKey,
    /// Encryption or storage failed.
    #[error("internal error")]
    Internal,
}

impl From<TeamProviderKeyError> for TeamAiApiKeyError {
    fn from(error: TeamProviderKeyError) -> Self {
        match error {
            TeamProviderKeyError::MalformedKey => Self::MalformedKey,
            other => {
                tracing::error!(error = ?other, "team ai api key operation failed");
                Self::Internal
            }
        }
    }
}

impl axum::response::IntoResponse for TeamAiApiKeyError {
    fn into_response(self) -> axum::response::Response {
        use axum::http::StatusCode;
        let status = match self {
            Self::MalformedKey => StatusCode::BAD_REQUEST,
            Self::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status,
            Json(model::response::ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

/// The providers the caller's team has its own AI API key for.
#[utoipa::path(
    get,
    path = "/team-ai-api-keys",
    operation_id = "get_team_ai_api_keys",
    responses(
        (status = 200, body = TeamAiApiKeys),
        (status = 401, body = String),
        (status = 403, body = model::response::ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, err)]
pub async fn list_handler(
    State(ctx): State<ApiContext>,
    team: MemberTeam,
) -> Result<Json<TeamAiApiKeys>, TeamAiApiKeyError> {
    let keys = ctx
        .team_provider_keys
        .list(&team.entity_access_receipt)
        .await?;
    Ok(Json(TeamAiApiKeys::from(keys)))
}

/// Registers or replaces the team's key for a provider. Team admins only.
#[utoipa::path(
    put,
    path = "/team-ai-api-keys/{provider}",
    operation_id = "put_team_ai_api_key",
    params(("provider" = TeamAiProvider, Path)),
    request_body = PutTeamAiApiKeyRequest,
    responses(
        (status = 200, body = TeamAiApiKeys),
        (status = 400, body = model::response::ErrorResponse),
        (status = 401, body = String),
        (status = 403, body = model::response::ErrorResponse),
    )
)]
// The body is skipped: it is the key itself.
#[tracing::instrument(skip_all, err, fields(provider = ?provider))]
pub async fn put_handler(
    State(ctx): State<ApiContext>,
    team: AdminTeam,
    Path(provider): Path<TeamAiProvider>,
    Json(req): Json<PutTeamAiApiKeyRequest>,
) -> Result<Json<TeamAiApiKeys>, TeamAiApiKeyError> {
    let keys = ctx
        .team_provider_keys
        .register(&team.entity_access_receipt, provider.into(), &req.api_key)
        .await?;
    Ok(Json(TeamAiApiKeys::from(keys)))
}

/// Forgets the team's key for a provider. Team admins only.
///
/// Does not revoke the key at the provider; succeeds when there was none.
#[utoipa::path(
    delete,
    path = "/team-ai-api-keys/{provider}",
    operation_id = "delete_team_ai_api_key",
    params(("provider" = TeamAiProvider, Path)),
    responses(
        (status = 200, body = TeamAiApiKeys),
        (status = 401, body = String),
        (status = 403, body = model::response::ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, err, fields(provider = ?provider))]
pub async fn delete_handler(
    State(ctx): State<ApiContext>,
    team: AdminTeam,
    Path(provider): Path<TeamAiProvider>,
) -> Result<Json<TeamAiApiKeys>, TeamAiApiKeyError> {
    let keys = ctx
        .team_provider_keys
        .remove(&team.entity_access_receipt, provider.into())
        .await?;
    Ok(Json(TeamAiApiKeys::from(keys)))
}
