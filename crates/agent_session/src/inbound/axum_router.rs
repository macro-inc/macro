//! Axum router and HTTP handlers exposing the agent session service.
//!
//! Every route authenticates its caller with
//! [`MacroAuthorizationExtractor`] under the [`UserOrBot`] policy: directly
//! authenticated users and bots are admitted, everything else is rejected at
//! the edge. Handlers only map transport DTOs to domain types and call the
//! [`AgentSessionService`]; they make no authorization or business
//! decisions.

use std::sync::Arc;

use agent_runtime_protocol::domain::schema::v0::SystemEvent;
use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use bots::domain::models::BotId;
use chrono::{DateTime, Utc};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrBot,
};
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::domain::error::AgentSessionError;
use crate::domain::model::{AgentSession, AgentSessionId, SessionStatus};
use crate::domain::service::AgentSessionService;

/// Shared state for the agent session router: the agent session service plus
/// the authorization state the request extractors authenticate against.
pub struct AgentSessionRouterState<T, Auth> {
    service: Arc<T>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<T, Auth> AgentSessionRouterState<T, Auth> {
    /// Create router state from a service and authorization state.
    pub fn new(service: T, authorization_state: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service: Arc::new(service),
            authorization_state,
        }
    }
}

// Manual Clone impl so T doesn't need to be Clone (it's behind Arc).
impl<T, Auth> Clone for AgentSessionRouterState<T, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<T, Auth> FromRef<AgentSessionRouterState<T, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &AgentSessionRouterState<T, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the agent session router. Mount it under the path prefix the
/// composition root chooses, e.g. `/agent-sessions`.
pub fn agent_session_router<T, Auth, S>(state: AgentSessionRouterState<T, Auth>) -> Router<S>
where
    T: AgentSessionService,
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/{session_id}",
            get(get_agent_session_handler::<T, Auth>)
                .put(update_agent_session_handler::<T, Auth>)
                .delete(delete_agent_session_handler::<T, Auth>),
        )
        .with_state(state)
}

/// Transport error for agent session handlers.
#[derive(Debug)]
pub enum AgentSessionApiError {
    /// The domain rejected the operation.
    Domain(AgentSessionError),
}

impl From<AgentSessionError> for AgentSessionApiError {
    fn from(error: AgentSessionError) -> Self {
        Self::Domain(error)
    }
}

impl IntoResponse for AgentSessionApiError {
    fn into_response(self) -> Response {
        match self {
            Self::Domain(error) => {
                tracing::error!(error = ?error, "agent session request failed");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal server error").into_response()
            }
        }
    }
}

/// Transport representation of a session's status, mirroring
/// [`SessionStatus`].
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SessionStatusDto {
    /// No status updates received.
    NoMessages,
    /// The last system event received from the runtime.
    Event {
        /// The wire name of the system event, e.g. `acp_ready`.
        #[schema(value_type = String)]
        event: SystemEvent,
    },
    /// The session disconnected without sending a closed event.
    Disconnected,
}

impl From<SessionStatus> for SessionStatusDto {
    fn from(status: SessionStatus) -> Self {
        match status {
            SessionStatus::NoMessages => Self::NoMessages,
            SessionStatus::Event(event) => Self::Event { event },
            SessionStatus::Disconnected => Self::Disconnected,
        }
    }
}

impl From<SessionStatusDto> for SessionStatus {
    fn from(status: SessionStatusDto) -> Self {
        match status {
            SessionStatusDto::NoMessages => Self::NoMessages,
            SessionStatusDto::Event { event } => Self::Event(event),
            SessionStatusDto::Disconnected => Self::Disconnected,
        }
    }
}

/// Request body for replacing an agent session. This is full-resource `PUT`
/// semantics: fetch the session, modify it, and send the whole thing back.
/// `channelId` and `createdAt` are immutable; echo the values returned by the
/// get endpoint.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgentSessionRequest {
    /// The session's dedicated channel. Immutable; echo the value returned
    /// by the get endpoint.
    pub channel_id: Uuid,
    /// The root message of the thread the session was created from, if any.
    pub thread_id: Option<Uuid>,
    /// The exact message that invoked the bot, if any.
    pub originating_message_id: Option<Uuid>,
    /// The bot running the agent.
    pub bot_id: Uuid,
    /// Model slug.
    pub model: String,
    /// Harness slug.
    pub harness: String,
    /// The repository the session works with.
    pub repo_url: String,
    /// The ACP session id, if one exists.
    pub acp_session_id: Option<String>,
    /// The session's status.
    pub status: SessionStatusDto,
    /// When the session was created. Immutable; echo the value returned by
    /// the get endpoint.
    pub created_at: DateTime<Utc>,
}

/// Response body describing an agent session.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionResponse {
    /// The session id.
    pub id: Uuid,
    /// The session's dedicated channel.
    pub channel_id: Uuid,
    /// The root message of the thread the session was created from, if any.
    pub thread_id: Option<Uuid>,
    /// The exact message that invoked the bot, if any.
    pub originating_message_id: Option<Uuid>,
    /// The bot running the agent.
    pub bot_id: Uuid,
    /// Model slug.
    pub model: String,
    /// Harness slug.
    pub harness: String,
    /// The repository the session works with.
    pub repo_url: String,
    /// The ACP session id, if one exists.
    pub acp_session_id: Option<String>,
    /// The session's status.
    pub status: SessionStatusDto,
    /// When the session was created.
    pub created_at: DateTime<Utc>,
    /// When the session was last modified.
    pub modified_at: DateTime<Utc>,
}

impl From<AgentSession> for AgentSessionResponse {
    fn from(session: AgentSession) -> Self {
        Self {
            id: session.id.as_uuid(),
            channel_id: session.channel_id,
            thread_id: session.thread_id,
            originating_message_id: session.originating_message_id,
            bot_id: session.bot_id.as_uuid(),
            model: session.model,
            harness: session.harness,
            repo_url: session.repo_url,
            acp_session_id: session.acp_session_id,
            status: session.status.into(),
            created_at: session.created_at,
            modified_at: session.modified_at,
        }
    }
}

#[utoipa::path(
    get,
    path = "/agent-sessions/{session_id}",
    tag = "agent-sessions",
    operation_id = "get_agent_session",
    params(("session_id" = Uuid, Path, description = "ID of the agent session")),
    responses(
        (status = 200, body = AgentSessionResponse),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 500, body = String),
    )
)]
/// Get an agent session by id.
#[tracing::instrument(
    skip(state, caller),
    fields(actor = %caller.acting_entity(), session_id = %session_id),
    err(Debug)
)]
pub async fn get_agent_session_handler<T: AgentSessionService, Auth: MacroAuthorizationService>(
    State(state): State<AgentSessionRouterState<T, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, UserOrBot>,
    Path(session_id): Path<Uuid>,
) -> Result<Json<AgentSessionResponse>, AgentSessionApiError> {
    let session = state
        .service
        .get_session(AgentSessionId::new_from_uuid(session_id))
        .await?;

    Ok(Json(session.into()))
}

#[utoipa::path(
    put,
    path = "/agent-sessions/{session_id}",
    tag = "agent-sessions",
    operation_id = "update_agent_session",
    params(("session_id" = Uuid, Path, description = "ID of the agent session")),
    request_body = UpdateAgentSessionRequest,
    responses(
        (status = 200),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 500, body = String),
    )
)]
/// Replace an agent session.
#[tracing::instrument(
    skip(state, caller, req),
    fields(actor = %caller.acting_entity(), session_id = %session_id),
    err(Debug)
)]
pub async fn update_agent_session_handler<
    T: AgentSessionService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<AgentSessionRouterState<T, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, UserOrBot>,
    Path(session_id): Path<Uuid>,
    Json(req): Json<UpdateAgentSessionRequest>,
) -> Result<StatusCode, AgentSessionApiError> {
    state
        .service
        .update_session(AgentSession {
            id: AgentSessionId::new_from_uuid(session_id),
            channel_id: req.channel_id,
            thread_id: req.thread_id,
            originating_message_id: req.originating_message_id,
            bot_id: BotId::new_from_uuid(req.bot_id),
            model: req.model,
            harness: req.harness,
            repo_url: req.repo_url,
            acp_session_id: req.acp_session_id,
            status: req.status.into(),
            created_at: req.created_at,
            modified_at: Utc::now(),
        })
        .await?;

    Ok(StatusCode::OK)
}

#[utoipa::path(
    delete,
    path = "/agent-sessions/{session_id}",
    tag = "agent-sessions",
    operation_id = "delete_agent_session",
    params(("session_id" = Uuid, Path, description = "ID of the agent session")),
    responses(
        (status = 200),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 500, body = String),
    )
)]
/// Delete an agent session and its dedicated channel.
#[tracing::instrument(
    skip(state, caller),
    fields(actor = %caller.acting_entity(), session_id = %session_id),
    err(Debug)
)]
pub async fn delete_agent_session_handler<
    T: AgentSessionService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<AgentSessionRouterState<T, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, UserOrBot>,
    Path(session_id): Path<Uuid>,
) -> Result<StatusCode, AgentSessionApiError> {
    state
        .service
        .delete_session(AgentSessionId::new_from_uuid(session_id))
        .await?;

    Ok(StatusCode::OK)
}
