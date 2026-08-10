//! Axum router and HTTP handlers exposing the agent session service.
//!
//! Every route authenticates its caller with
//! [`MacroAuthorizationExtractor`] under the [`UserOrBot`] policy: directly
//! authenticated users and bots are admitted, everything else is rejected at
//! the edge. Handlers only map transport DTOs to domain types and call the
//! [`AgentSessionService`]; they make no authorization or business
//! decisions.

#[cfg(test)]
mod test;

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
use crate::domain::model::{
    AgentSession, AgentSessionId, AgentSessionLog, ChannelSessionLog, Message, SessionStatus,
};
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
        .route(
            "/channel/{channel_id}/log",
            get(get_agent_channel_log_handler::<T, Auth>),
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

/// Response body for a channel's raw agent-session log.
///
/// The frames themselves: this endpoint does not fold, its readers do.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentChannelLogResponse {
    /// The session the entries belong to, absent when no agent session owns
    /// the channel.
    ///
    /// Absent rather than a `404`, because every channel asks. A client has
    /// no cheap way to know whether a channel is an agent channel before it
    /// looks: the channel record it would have to consult is only ever
    /// fetched as part of a list, which can predate the channel. So "no
    /// session here" is an ordinary answer to an ordinary question, not a
    /// failure.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_session_id: Option<Uuid>,
    /// The agent whose messages the log derives, absent for the same reason
    /// the session id is.
    ///
    /// Here because a client renders those messages and cannot otherwise work
    /// out who sent them: the sender of an agent message is this session's
    /// bot, and no other response a channel fetches names it. Asking for the
    /// channel's bots is the wrong question - those are bots explicitly added
    /// to a channel, which a session's agent need not be.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bot: Option<SessionBotDto>,
    /// Every logged frame, oldest first. Folding depends on this order. Empty
    /// when there is no session.
    pub entries: Vec<AgentSessionLogEntryDto>,
}

impl AgentChannelLogResponse {
    /// The answer for a channel no agent session owns.
    fn none() -> Self {
        Self {
            agent_session_id: None,
            bot: None,
            entries: Vec::new(),
        }
    }
}

impl From<ChannelSessionLog> for AgentChannelLogResponse {
    fn from(log: ChannelSessionLog) -> Self {
        Self {
            agent_session_id: Some(log.agent_session_id.as_uuid()),
            bot: Some(SessionBotDto {
                id: log.bot.id.as_uuid(),
                name: log.bot.name,
                avatar_url: log.bot.avatar_url,
            }),
            entries: log.entries.into_iter().map(Into::into).collect(),
        }
    }
}

/// The agent behind a session, mirroring [`SessionBot`].
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionBotDto {
    /// The bot's id. A message it sent has `"bot|{id}"` as its sender.
    pub id: Uuid,
    /// Display name.
    pub name: String,
    /// Avatar, when it has one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
}

/// One entry of a session's protocol log.
///
/// Serializes as `{"userId": ..., "direction": ..., "content": ...}` - the
/// frame's own two fields, flattened in beside the attribution, which is the
/// same shape a recorded session's JSONL carries. A reader can deserialize the
/// `direction`/`content` pair straight back into the fold's own log type
/// rather than through a transport vocabulary of its own.
///
/// `agentSessionId` is not repeated per entry: every entry in a response
/// belongs to the session named once at the top.
///
/// `Deserialize` is for the wire-contract tests only - nothing server-side
/// decodes its own response type.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct AgentSessionLogEntryDto {
    /// The user whose action produced the frame, absent when no user did.
    ///
    /// Only prompts carry one, and only when the frame was attributed at the
    /// time - a replayed or recorded session's are anonymous.
    #[serde(rename = "userId", skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    /// The frame: `direction` and the protocol envelope under `content`.
    ///
    /// Serialized by [`Message`] itself rather than rebuilt field by field, so
    /// the bytes on the wire are exactly what the fold's own log type reads
    /// back. [`LogFrameDto`] describes the two fields that produces.
    #[serde(flatten)]
    #[schema(value_type = LogFrameDto)]
    pub message: Message,
}

/// The two fields [`AgentSessionLogEntryDto`] flattens in.
///
/// Schema only. Nothing constructs one: the entry serializes through
/// [`Message`], and this exists so the generated clients see `direction` and
/// `content` as named fields instead of an open map. A hand-built copy could
/// drift from the fold's wire format, and the point of the endpoint is that it
/// cannot - so this describes that format without being able to produce it.
#[derive(Debug, Serialize, ToSchema)]
pub struct LogFrameDto {
    /// Which way the frame travelled.
    pub direction: LogDirectionDto,
    /// The protocol envelope, verbatim. Opaque here: it is Agent Runtime
    /// Protocol, whose shape belongs to the fold rather than this endpoint.
    #[schema(value_type = Object)]
    pub content: serde_json::Value,
}

/// Which way a logged frame travelled, mirroring [`Message`]'s discriminant.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LogDirectionDto {
    /// Runtime → server.
    ToServer,
    /// Server → runtime.
    ToRuntime,
}

impl From<AgentSessionLog> for AgentSessionLogEntryDto {
    fn from(entry: AgentSessionLog) -> Self {
        Self {
            user_id: entry.user_id.map(|user| user.to_string()),
            message: entry.content,
        }
    }
}

#[utoipa::path(
    get,
    path = "/agent-sessions/channel/{channel_id}/log",
    tag = "agent-sessions",
    operation_id = "get_agent_channel_log",
    params(("channel_id" = Uuid, Path, description = "ID of the session's dedicated channel")),
    responses(
        (status = 200, body = AgentChannelLogResponse),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
/// The raw protocol log of the agent session behind a channel.
///
/// Served unfolded for a client that runs the fold itself.
///
/// Answers for any channel, not only an agent one: a channel with no session
/// gets an empty log rather than a `404`. Clients call this on every channel
/// load, because knowing whether a channel is an agent channel first would
/// cost them a lookup they do not otherwise make.
///
/// The whole log, with no paging: the fold is a left fold over the frames from
/// the beginning, so a reader that skipped any of them would derive different
/// turn numbering - and turn numbering is what joins these to the channel's
/// placeholder rows.
#[tracing::instrument(
    skip(state, caller),
    fields(actor = %caller.acting_entity(), channel_id = %channel_id),
    err(Debug)
)]
pub async fn get_agent_channel_log_handler<
    T: AgentSessionService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<AgentSessionRouterState<T, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, UserOrBot>,
    Path(channel_id): Path<Uuid>,
) -> Result<Json<AgentChannelLogResponse>, AgentSessionApiError> {
    let log = state.service.channel_log(channel_id).await?;

    Ok(Json(
        log.map_or_else(AgentChannelLogResponse::none, Into::into),
    ))
}
