//! Thin HTTP projection for the private agent-conversation read service.

use crate::domain::direct_messages::{AgentDmConversation, AgentDmConversations, AgentDmError};
use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::ToSchema;

/// An explicit context boundary; all channel messages remain visible.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentDmSegmentDto {
    /// Session whose controls and live events belong to this segment.
    pub session_id: Uuid,
    /// When the segment began.
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// Whether this is the current agent context.
    pub is_current: bool,
}

/// Metadata visible only to the user who owns the DM.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentDmConversationDto {
    /// The channel containing the visible transcript.
    pub channel_id: Uuid,
    /// Persona id (without the bot principal prefix).
    pub bot_id: Uuid,
    /// Persona's historical display name.
    pub name: String,
    /// Optional persona avatar.
    pub avatar_url: Option<String>,
    /// Whether the owner may currently send a new prompt.
    pub available: bool,
    /// Whether new persona settings are available to adopt explicitly.
    pub settings_changed: bool,
    /// Context segments in chronological order.
    pub segments: Vec<AgentDmSegmentDto>,
    /// Persistent state of each accepted message and its current attempt.
    pub turns: Vec<AgentDmTurnDto>,
}

/// Execution status without exposing the persona prompt or stored credentials.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentDmTurnDto {
    /// The user's message in the channel timeline.
    pub source_message_id: Uuid,
    /// Current runtime attempt identity.
    pub action_id: Uuid,
    /// Context segment carrying this turn.
    pub session_id: Uuid,
    /// The associated agent reply, if it has been posted.
    pub reply_message_id: Option<Uuid>,
    /// Durable execution state.
    pub state: crate::domain::dm_turns::DmTurnState,
    /// When the source message was first accepted.
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl From<AgentDmConversation> for AgentDmConversationDto {
    fn from(value: AgentDmConversation) -> Self {
        Self {
            channel_id: value.channel_id,
            bot_id: value.persona.id.as_uuid(),
            name: value.persona.name,
            avatar_url: value.persona.avatar_url,
            available: value.available,
            settings_changed: value.settings_changed,
            turns: value
                .turns
                .into_iter()
                .map(|turn| AgentDmTurnDto {
                    source_message_id: turn.source_message_id,
                    action_id: turn.action_id.as_uuid(),
                    session_id: turn.session_id.as_uuid(),
                    reply_message_id: turn.reply_message_id,
                    state: turn.state,
                    created_at: turn.created_at,
                })
                .collect(),
            segments: value
                .segments
                .into_iter()
                .map(|segment| AgentDmSegmentDto {
                    session_id: segment.session_id.as_uuid(),
                    created_at: segment.created_at,
                    is_current: segment.is_current,
                })
                .collect(),
        }
    }
}

/// Independently authenticated conversation router state.
pub struct AgentDmRouterState<S, A> {
    service: Arc<S>,
    authorization: MacroAuthorizationState<A>,
}

impl<S, A> AgentDmRouterState<S, A> {
    /// Compose the domain service and user authentication.
    pub fn new(service: Arc<S>, authorization: MacroAuthorizationState<A>) -> Self {
        Self {
            service,
            authorization,
        }
    }
}

impl<S, A> Clone for AgentDmRouterState<S, A> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization: self.authorization.clone(),
        }
    }
}

impl<S, A> FromRef<AgentDmRouterState<S, A>> for MacroAuthorizationState<A> {
    fn from_ref(state: &AgentDmRouterState<S, A>) -> Self {
        state.authorization.clone()
    }
}

/// Read a channel's agent conversation, without allocating a runtime.
pub fn agent_dm_router<S: AgentDmConversations, A: MacroAuthorizationService>(
    state: AgentDmRouterState<S, A>,
) -> Router {
    Router::new()
        .route("/agent-dms/{channel_id}", get(get_agent_dm::<S, A>))
        .route(
            "/agent-dms/{channel_id}/start-fresh",
            post(start_fresh_agent_dm::<S, A>),
        )
        .route(
            "/agent-dms/{channel_id}/turns/{source}/retry",
            post(retry_agent_dm::<S, A>),
        )
        .with_state(state)
}

/// The context the user is choosing to leave behind.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartFreshAgentDmRequest {
    /// Current session id shown in the conversation metadata.
    pub session_id: Uuid,
}

/// Start a fresh agent context, retaining the channel transcript.
#[utoipa::path(
    post,
    path = "/agent-dms/{channel_id}/start-fresh",
    tag = "agent-dms",
    security(("bearerAuth" = [])),
    params(("channel_id" = Uuid, Path)),
    request_body = StartFreshAgentDmRequest,
    responses((status = 204, description = "New context reserved"), (status = 404, description = "Conversation not found"), (status = 409, description = "Context is busy, stale or unavailable"), (status = 503, description = "Temporarily unavailable"))
)]
pub async fn start_fresh_agent_dm<S: AgentDmConversations, A: MacroAuthorizationService>(
    State(state): State<AgentDmRouterState<S, A>>,
    authorization: MacroAuthorizationExtractor<A, UserOnly>,
    Path(channel_id): Path<Uuid>,
    Json(request): Json<StartFreshAgentDmRequest>,
) -> Response {
    match state
        .service
        .start_fresh(
            authorization.authorization.macro_user_id.clone(),
            channel_id,
            agent_session::domain::model::AgentSessionId::new_from_uuid(request.session_id),
        )
        .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(AgentDmError::NotFound) => StatusCode::NOT_FOUND.into_response(),
        Err(AgentDmError::ContextBusy | AgentDmError::NotRetryable) => {
            StatusCode::CONFLICT.into_response()
        }
        Err(error) => {
            tracing::error!(?error, %channel_id, "failed to reset agent DM context");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

/// The attempt the user saw and chose to retry; prevents double-click reruns.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RetryAgentDmRequest {
    /// Current failed attempt identity.
    pub action_id: Uuid,
}

/// Explicitly retry a failed DM message in its current context segment.
#[utoipa::path(
    post,
    path = "/agent-dms/{channel_id}/turns/{source}/retry",
    tag = "agent-dms",
    security(("bearerAuth" = [])),
    params(("channel_id" = Uuid, Path), ("source" = Uuid, Path)),
    request_body = RetryAgentDmRequest,
    responses((status = 204, description = "Retry queued"), (status = 404, description = "Conversation or turn not found"), (status = 409, description = "Attempt cannot be retried"), (status = 503, description = "Temporarily unavailable"))
)]
pub async fn retry_agent_dm<S: AgentDmConversations, A: MacroAuthorizationService>(
    State(state): State<AgentDmRouterState<S, A>>,
    authorization: MacroAuthorizationExtractor<A, UserOnly>,
    Path((channel_id, source)): Path<(Uuid, Uuid)>,
    Json(request): Json<RetryAgentDmRequest>,
) -> Response {
    match state
        .service
        .retry(
            authorization.authorization.macro_user_id.clone(),
            channel_id,
            source,
            agent_runtime_protocol::domain::action::AgentActionId::from_uuid(request.action_id),
        )
        .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(AgentDmError::NotFound) => StatusCode::NOT_FOUND.into_response(),
        Err(AgentDmError::NotRetryable) => StatusCode::CONFLICT.into_response(),
        Err(error) => {
            tracing::error!(?error, %channel_id, %source, "failed to retry agent DM");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

/// Ordinary channels and another user's agent DMs are both not found.
#[utoipa::path(
    get,
    path = "/agent-dms/{channel_id}",
    tag = "agent-dms",
    security(("bearerAuth" = [])),
    params(("channel_id" = Uuid, Path, description = "Conversation channel")),
    responses(
        (status = 200, description = "Owner's agent conversation", body = AgentDmConversationDto),
        (status = 404, description = "Conversation not found"),
        (status = 503, description = "Conversation temporarily unavailable"),
    )
)]
pub async fn get_agent_dm<S: AgentDmConversations, A: MacroAuthorizationService>(
    State(state): State<AgentDmRouterState<S, A>>,
    authorization: MacroAuthorizationExtractor<A, UserOnly>,
    Path(channel_id): Path<Uuid>,
) -> Response {
    match state
        .service
        .get(
            authorization.authorization.macro_user_id.clone(),
            channel_id,
        )
        .await
    {
        Ok(Some(result)) => Json(AgentDmConversationDto::from(result)).into_response(),
        Ok(None) | Err(AgentDmError::NotFound) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => {
            tracing::error!(?error, %channel_id, "failed to read agent DM");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                "Could not load this conversation",
            )
                .into_response()
        }
    }
}
