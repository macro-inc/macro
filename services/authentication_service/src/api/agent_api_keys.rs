//! An agent's own Anthropic or OpenAI API key, set from the agent's settings.
//!
//! Whoever may edit the agent may set or remove its key: its owner, or any
//! member of its team (the agents' own rule, from `BotService`). Like the
//! Cursor key, a saved key is never readable again through this API.

use agent_api_keys::domain::{
    AgentKeyError, AgentKeyStatus, AgentKeyView, AgentOwner, KeyedAgent, ModelProvider,
};
use axum::{
    Json, Router,
    extract::{Path, State},
    routing::get,
};
use bot_id::BotId;
use bots::domain::{
    models::{Agent, BotOwner},
    ports::{BotError, BotService},
};
use macro_authorization::{MacroAuthorizationExtractor, UserOnly};
use macro_user_id::user_id::MacroUserIdStr;
use utoipa::ToSchema;

use crate::api::context::{ApiContext, AuthorizationService};

type Caller = MacroAuthorizationExtractor<AuthorizationService, UserOnly>;

/// Routes for an agent's API key, under `/agents/{agent_id}/api-key`.
pub fn router() -> Router<ApiContext> {
    Router::new().route(
        "/{agent_id}/api-key",
        get(get_handler).put(put_handler).delete(delete_handler),
    )
}

/// A provider an agent can bring its own key for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum AgentApiKeyProvider {
    /// Anthropic (`sk-ant-…` keys).
    Anthropic,
    /// OpenAI (`sk-…` keys).
    Openai,
}

impl From<ModelProvider> for AgentApiKeyProvider {
    fn from(provider: ModelProvider) -> Self {
        match provider {
            ModelProvider::Anthropic => Self::Anthropic,
            ModelProvider::OpenAi => Self::Openai,
        }
    }
}

/// The agent's saved key. Never includes the key.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SavedAgentApiKey {
    /// The provider the key is for.
    pub provider: AgentApiKeyProvider,
    /// When the key was last replaced.
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl From<AgentKeyStatus> for SavedAgentApiKey {
    fn from(status: AgentKeyStatus) -> Self {
        Self {
            provider: status.provider.into(),
            updated_at: status.updated_at,
        }
    }
}

/// An agent's API key, and whether its turns can run on it.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentApiKey {
    /// The saved key, if any.
    pub key: Option<SavedAgentApiKey>,
    /// Whether the agent owner's plan includes API keys. A key saved before a
    /// downgrade is still listed, and removable, but unused.
    pub plan_allows: bool,
}

impl From<AgentKeyView> for AgentApiKey {
    fn from(view: AgentKeyView) -> Self {
        Self {
            key: view.key.map(Into::into),
            plan_allows: view.plan_allows,
        }
    }
}

/// The key someone pasted.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PutAgentApiKeyRequest {
    /// An Anthropic (`sk-ant-…`) or OpenAI (`sk-…`) key, for the provider of
    /// the agent's model.
    pub api_key: String,
}

/// Why an agent API key request failed.
#[derive(Debug, thiserror::Error)]
pub enum AgentApiKeyError {
    /// No live agent with this id.
    #[error("agent not found")]
    NotFound,
    /// The caller may not change this agent.
    #[error("you cannot change this agent")]
    Forbidden,
    /// The value is not a key for the agent's model's provider.
    #[error("value does not look like an API key for this agent's model")]
    MalformedKey,
    /// The agent is not an in-memory agent on an Anthropic or OpenAI model.
    #[error("only agents that run in Macro on an Anthropic or OpenAI model can use an API key")]
    UnsupportedAgent,
    /// The agent owner's plan does not include API keys.
    #[error("agent API keys are part of the Premium and Max plans")]
    PlanRequired,
    /// Encryption, storage, or a lookup failed.
    #[error("internal error")]
    Internal,
}

impl From<AgentKeyError> for AgentApiKeyError {
    fn from(error: AgentKeyError) -> Self {
        match error {
            AgentKeyError::MalformedKey => Self::MalformedKey,
            AgentKeyError::UnsupportedAgent => Self::UnsupportedAgent,
            AgentKeyError::PlanRequired => Self::PlanRequired,
            other => {
                tracing::error!(error = ?other, "agent api key operation failed");
                Self::Internal
            }
        }
    }
}

impl From<BotError> for AgentApiKeyError {
    fn from(error: BotError) -> Self {
        match error {
            BotError::NotFound(_) => Self::NotFound,
            BotError::Unauthorized => Self::Forbidden,
            other => {
                tracing::error!(error = ?other, "could not read the agent");
                Self::Internal
            }
        }
    }
}

impl axum::response::IntoResponse for AgentApiKeyError {
    fn into_response(self) -> axum::response::Response {
        use axum::http::StatusCode;
        let status = match self {
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::Forbidden | Self::PlanRequired => StatusCode::FORBIDDEN,
            Self::MalformedKey | Self::UnsupportedAgent => StatusCode::BAD_REQUEST,
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

/// The agent the caller may change, as the key policy needs it.
async fn keyed_agent(
    ctx: &ApiContext,
    caller: &Caller,
    agent_id: BotId,
) -> Result<KeyedAgent, AgentApiKeyError> {
    let agent: Agent = ctx
        .bots
        .manageable_agent(caller.authorization.macro_user_id.clone(), agent_id)
        .await?;
    let owner = match agent.bot.owner {
        Some(BotOwner::User { user_id }) => AgentOwner::User(
            MacroUserIdStr::try_from(user_id).map_err(|_| AgentApiKeyError::Internal)?,
        ),
        Some(BotOwner::Team { team_id }) => AgentOwner::Team(team_id),
        None => return Err(AgentApiKeyError::Forbidden),
    };
    Ok(KeyedAgent {
        bot_id: agent.bot.id.as_uuid(),
        owner,
        harness: agent.harness,
        model: agent.default_model,
    })
}

/// The agent's API key, if it has one, and whether its plan allows one.
#[utoipa::path(
    get,
    path = "/agents/{agent_id}/api-key",
    operation_id = "get_agent_api_key",
    params(("agent_id" = String, Path)),
    responses(
        (status = 200, body = AgentApiKey),
        (status = 401, body = String),
        (status = 403, body = model::response::ErrorResponse),
        (status = 404, body = model::response::ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, err, fields(agent_id = %agent_id))]
pub async fn get_handler(
    State(ctx): State<ApiContext>,
    caller: Caller,
    Path(agent_id): Path<BotId>,
) -> Result<Json<AgentApiKey>, AgentApiKeyError> {
    let agent = keyed_agent(&ctx, &caller, agent_id).await?;
    Ok(Json(ctx.agent_api_keys.view(&agent).await?.into()))
}

/// Registers or replaces the agent's API key, for its model's provider.
/// Only in-memory agents on an Anthropic or OpenAI model, on a paid plan.
#[utoipa::path(
    put,
    path = "/agents/{agent_id}/api-key",
    operation_id = "put_agent_api_key",
    params(("agent_id" = String, Path)),
    request_body = PutAgentApiKeyRequest,
    responses(
        (status = 200, body = AgentApiKey),
        (status = 400, body = model::response::ErrorResponse),
        (status = 401, body = String),
        (status = 403, body = model::response::ErrorResponse),
        (status = 404, body = model::response::ErrorResponse),
    )
)]
// The body is skipped: it is the key itself.
#[tracing::instrument(skip_all, err, fields(agent_id = %agent_id))]
pub async fn put_handler(
    State(ctx): State<ApiContext>,
    caller: Caller,
    Path(agent_id): Path<BotId>,
    Json(req): Json<PutAgentApiKeyRequest>,
) -> Result<Json<AgentApiKey>, AgentApiKeyError> {
    let agent = keyed_agent(&ctx, &caller, agent_id).await?;
    Ok(Json(
        ctx.agent_api_keys.set(&agent, &req.api_key).await?.into(),
    ))
}

/// Forgets the agent's API key. Does not revoke it at the provider; succeeds
/// when there was none.
#[utoipa::path(
    delete,
    path = "/agents/{agent_id}/api-key",
    operation_id = "delete_agent_api_key",
    params(("agent_id" = String, Path)),
    responses(
        (status = 200, body = AgentApiKey),
        (status = 401, body = String),
        (status = 403, body = model::response::ErrorResponse),
        (status = 404, body = model::response::ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, err, fields(agent_id = %agent_id))]
pub async fn delete_handler(
    State(ctx): State<ApiContext>,
    caller: Caller,
    Path(agent_id): Path<BotId>,
) -> Result<Json<AgentApiKey>, AgentApiKeyError> {
    let agent = keyed_agent(&ctx, &caller, agent_id).await?;
    Ok(Json(ctx.agent_api_keys.remove(&agent).await?.into()))
}
