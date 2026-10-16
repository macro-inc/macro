//! Thin HTTP projection for agent conversations in channels.

use crate::domain::conversations::{AgentConversations, ConversationError, ConversationOverview};
use agent_session::domain::agent_conversation::AgentConversation;
use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use bot_id::BotId;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::ToSchema;

/// One session a conversation has run on; every channel message stays visible.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentConversationSessionDto {
    /// Session whose controls and live events belong to this context.
    pub session_id: Uuid,
    /// When the session began.
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// Whether this is the current agent context.
    pub is_current: bool,
}

/// An agent's conversation in a channel, as the person it is with sees it.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentConversationDto {
    /// The channel containing the visible transcript.
    pub channel_id: Uuid,
    /// Persona id (without the bot principal prefix).
    pub bot_id: Uuid,
    /// Persona's historical display name.
    pub name: String,
    /// Optional persona avatar.
    pub avatar_url: Option<String>,
    /// Whether the caller may currently send a new prompt.
    pub available: bool,
    /// Whether new persona settings are available to adopt explicitly.
    pub settings_changed: bool,
    /// The sessions the conversation has run on, oldest first.
    pub sessions: Vec<AgentConversationSessionDto>,
    /// Persistent state of each accepted message and its current attempt.
    pub turns: Vec<AgentConversationTurnDto>,
}

/// The agent conversations in a channel the caller may see.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentConversationsDto {
    /// Empty for ordinary channels and other people's conversations.
    pub conversations: Vec<AgentConversationDto>,
}

/// Execution status without exposing the persona prompt or stored credentials.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentConversationTurnDto {
    /// The user's message in the channel timeline.
    pub source_message_id: Uuid,
    /// Current runtime attempt identity.
    pub action_id: Uuid,
    /// Session carrying this turn.
    pub session_id: Uuid,
    /// The associated agent reply, if it has been posted.
    pub reply_message_id: Option<Uuid>,
    /// Durable execution state.
    pub state: crate::domain::conversation_turns::ConversationTurnState,
    /// Whether Retry would be accepted now. A failed attempt is not retryable
    /// until its reply says how it ended.
    pub retryable: bool,
    /// When the source message was first accepted.
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl From<ConversationOverview> for AgentConversationDto {
    fn from(value: ConversationOverview) -> Self {
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
                .map(|turn| AgentConversationTurnDto {
                    source_message_id: turn.source_message_id,
                    action_id: turn.action_id.as_uuid(),
                    session_id: turn.session_id.as_uuid(),
                    reply_message_id: turn.reply_message_id,
                    state: turn.state,
                    retryable: turn.retryable,
                    created_at: turn.created_at,
                })
                .collect(),
            sessions: value
                .sessions
                .into_iter()
                .map(|session| AgentConversationSessionDto {
                    session_id: session.session_id.as_uuid(),
                    created_at: session.created_at,
                    is_current: session.is_current,
                })
                .collect(),
        }
    }
}

/// Independently authenticated conversation router state.
pub struct AgentConversationRouterState<S, A> {
    service: Arc<S>,
    authorization: MacroAuthorizationState<A>,
}

impl<S, A> AgentConversationRouterState<S, A> {
    /// Compose the domain service and user authentication.
    pub fn new(service: Arc<S>, authorization: MacroAuthorizationState<A>) -> Self {
        Self {
            service,
            authorization,
        }
    }
}

impl<S, A> Clone for AgentConversationRouterState<S, A> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization: self.authorization.clone(),
        }
    }
}

impl<S, A> FromRef<AgentConversationRouterState<S, A>> for MacroAuthorizationState<A> {
    fn from_ref(state: &AgentConversationRouterState<S, A>) -> Self {
        state.authorization.clone()
    }
}

/// Read and control a channel's agent conversations, without allocating a runtime.
pub fn agent_conversation_router<S: AgentConversations, A: MacroAuthorizationService>(
    state: AgentConversationRouterState<S, A>,
) -> Router {
    Router::new()
        .route(
            "/agent-conversations/{channel_id}",
            get(list_agent_conversations::<S, A>),
        )
        .route(
            "/agent-conversations/{channel_id}/{bot_id}/start-fresh",
            post(start_fresh_agent_conversation::<S, A>),
        )
        .route(
            "/agent-conversations/{channel_id}/{bot_id}/turns/{source}/retry",
            post(retry_agent_conversation_turn::<S, A>),
        )
        .with_state(state)
}

/// The session the user is choosing to leave behind.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartFreshAgentConversationRequest {
    /// Current session id shown in the conversation metadata.
    pub session_id: Uuid,
}

/// Start a fresh agent context, retaining the channel transcript.
#[utoipa::path(
    post,
    path = "/agent-conversations/{channel_id}/{bot_id}/start-fresh",
    tag = "agent-conversations",
    security(("bearerAuth" = [])),
    params(("channel_id" = Uuid, Path), ("bot_id" = Uuid, Path, description = "Persona the conversation is with")),
    request_body = StartFreshAgentConversationRequest,
    responses((status = 204, description = "New context reserved"), (status = 404, description = "Conversation not found"), (status = 409, description = "Context is busy, stale or unavailable"), (status = 503, description = "Temporarily unavailable"))
)]
pub async fn start_fresh_agent_conversation<S: AgentConversations, A: MacroAuthorizationService>(
    State(state): State<AgentConversationRouterState<S, A>>,
    authorization: MacroAuthorizationExtractor<A, UserOnly>,
    Path((channel_id, bot_id)): Path<(Uuid, Uuid)>,
    Json(request): Json<StartFreshAgentConversationRequest>,
) -> Response {
    match state
        .service
        .start_fresh(
            authorization.authorization.macro_user_id.clone(),
            AgentConversation {
                channel_id,
                bot_id: BotId::new_from_uuid(bot_id),
            },
            agent_session::domain::model::AgentSessionId::new_from_uuid(request.session_id),
        )
        .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(ConversationError::NotFound) => StatusCode::NOT_FOUND.into_response(),
        Err(ConversationError::ContextBusy | ConversationError::NotRetryable) => {
            StatusCode::CONFLICT.into_response()
        }
        Err(error) => {
            tracing::error!(?error, %channel_id, %bot_id, "failed to reset agent conversation context");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

/// The attempt the user saw and chose to retry; prevents double-click reruns.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RetryAgentConversationTurnRequest {
    /// Current failed attempt identity.
    pub action_id: Uuid,
}

/// Explicitly retry a failed message in the conversation's current session.
#[utoipa::path(
    post,
    path = "/agent-conversations/{channel_id}/{bot_id}/turns/{source}/retry",
    tag = "agent-conversations",
    security(("bearerAuth" = [])),
    params(("channel_id" = Uuid, Path), ("bot_id" = Uuid, Path, description = "Persona the conversation is with"), ("source" = Uuid, Path)),
    request_body = RetryAgentConversationTurnRequest,
    responses((status = 204, description = "Retry queued"), (status = 404, description = "Conversation or turn not found"), (status = 409, description = "Attempt cannot be retried"), (status = 503, description = "Temporarily unavailable"))
)]
pub async fn retry_agent_conversation_turn<S: AgentConversations, A: MacroAuthorizationService>(
    State(state): State<AgentConversationRouterState<S, A>>,
    authorization: MacroAuthorizationExtractor<A, UserOnly>,
    Path((channel_id, bot_id, source)): Path<(Uuid, Uuid, Uuid)>,
    Json(request): Json<RetryAgentConversationTurnRequest>,
) -> Response {
    match state
        .service
        .retry(
            authorization.authorization.macro_user_id.clone(),
            AgentConversation {
                channel_id,
                bot_id: BotId::new_from_uuid(bot_id),
            },
            source,
            agent_runtime_protocol::domain::action::AgentActionId::from_uuid(request.action_id),
        )
        .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(ConversationError::NotFound) => StatusCode::NOT_FOUND.into_response(),
        Err(ConversationError::NotRetryable) => StatusCode::CONFLICT.into_response(),
        Err(error) => {
            tracing::error!(?error, %channel_id, %bot_id, %source, "failed to retry agent conversation turn");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

/// The agent conversations in a channel the caller may see. Ordinary channels
/// and other people's conversations list none.
#[utoipa::path(
    get,
    path = "/agent-conversations/{channel_id}",
    tag = "agent-conversations",
    security(("bearerAuth" = [])),
    params(("channel_id" = Uuid, Path, description = "Conversation channel")),
    responses(
        (status = 200, description = "The caller's agent conversations in the channel", body = AgentConversationsDto),
        (status = 503, description = "Conversations temporarily unavailable"),
    )
)]
pub async fn list_agent_conversations<S: AgentConversations, A: MacroAuthorizationService>(
    State(state): State<AgentConversationRouterState<S, A>>,
    authorization: MacroAuthorizationExtractor<A, UserOnly>,
    Path(channel_id): Path<Uuid>,
) -> Response {
    match state
        .service
        .list(
            authorization.authorization.macro_user_id.clone(),
            channel_id,
        )
        .await
    {
        Ok(conversations) => Json(AgentConversationsDto {
            conversations: conversations
                .into_iter()
                .map(AgentConversationDto::from)
                .collect(),
        })
        .into_response(),
        Err(error) => {
            tracing::error!(?error, %channel_id, "failed to read agent conversations");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                "Could not load this conversation",
            )
                .into_response()
        }
    }
}
