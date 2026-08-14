//! Axum router and HTTP handlers exposing the agent session service.
//!
//! Every route authenticates its caller and then authorizes them with
//! [`AgentSessionAccessLevelExtractor`], checked before the handler body
//! runs: viewing a session or its log needs `View`, controlling or deleting
//! one needs `Owner`. Permission comes from the session's own `entity_access`
//! rows - the owner with owner access, the mention's channel as editor - never
//! from any channel the session was once rendered in. Handlers only map
//! transport DTOs to domain types and call the [`AgentSessionService`]; they
//! make no authorization or business decisions of their own.

use std::sync::Arc;

use agent_runtime_protocol::domain::{
    action::{AgentAction, AgentActionId},
    schema::v0::SystemEvent,
};
use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use chrono::DateTime;
use chrono::Utc;
use entity_access::domain::models::{OwnerAccessLevel, ViewAccessLevel};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::AgentSessionAccessLevelExtractor;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrBot,
};
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::domain::error::AgentSessionError;
use crate::domain::model::{
    AgentSession, AgentSessionId, Message, SessionBot, SessionStatus, StoredAgentSessionLog,
};
use crate::domain::ports::{AgentSessionNotificationRecipient, ControlEvent};
use crate::domain::service::AgentSessionService;

/// Shared state for the agent session router: the agent session service plus
/// the authorization state the request extractors authenticate against.
pub struct AgentSessionRouterState<T, Access, Auth> {
    service: Arc<T>,
    entity_access: Arc<Access>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<T, Access, Auth> AgentSessionRouterState<T, Access, Auth> {
    /// Create router state from a service, the entity access service its
    /// permission extractors resolve grants through, and authorization state.
    pub fn new(
        service: T,
        entity_access: Arc<Access>,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service: Arc::new(service),
            entity_access,
            authorization_state,
        }
    }
}

// Manual Clone impl so T doesn't need to be Clone (it's behind Arc).
impl<T, Access, Auth> Clone for AgentSessionRouterState<T, Access, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            entity_access: Arc::clone(&self.entity_access),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<T, Access, Auth> FromRef<AgentSessionRouterState<T, Access, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &AgentSessionRouterState<T, Access, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

impl<T, Access, Auth> FromRef<AgentSessionRouterState<T, Access, Auth>> for Arc<Access> {
    fn from_ref(state: &AgentSessionRouterState<T, Access, Auth>) -> Self {
        Arc::clone(&state.entity_access)
    }
}

/// Shared state for the control routes: the recipient holding the session's
/// live resources, plus the authorization state the extractors run against.
pub struct AgentSessionControlState<R, Access, Auth> {
    recipient: Arc<R>,
    entity_access: Arc<Access>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<R, Access, Auth> AgentSessionControlState<R, Access, Auth> {
    /// Create control state from a recipient, the entity access service its
    /// permission extractors resolve grants through, and authorization state.
    pub fn new(
        recipient: Arc<R>,
        entity_access: Arc<Access>,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            recipient,
            entity_access,
            authorization_state,
        }
    }
}

// Manual Clone impl so R doesn't need to be Clone (it's behind Arc).
impl<R, Access, Auth> Clone for AgentSessionControlState<R, Access, Auth> {
    fn clone(&self) -> Self {
        Self {
            recipient: Arc::clone(&self.recipient),
            entity_access: Arc::clone(&self.entity_access),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<R, Access, Auth> FromRef<AgentSessionControlState<R, Access, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &AgentSessionControlState<R, Access, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

impl<R, Access, Auth> FromRef<AgentSessionControlState<R, Access, Auth>> for Arc<Access> {
    fn from_ref(state: &AgentSessionControlState<R, Access, Auth>) -> Self {
        Arc::clone(&state.entity_access)
    }
}

/// Build the read-only agent session router. Mount it under the path prefix
/// the composition root chooses, e.g. `/agent-sessions`.
///
/// Separate from [`agent_session_control_router`] because reads depend on the
/// session query service while controls depend on the live-session recipient.
pub fn agent_session_read_router<T, Access, Auth, S>(
    state: AgentSessionRouterState<T, Access, Auth>,
) -> Router<S>
where
    T: AgentSessionService,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/{session_id}",
            get(get_agent_session_handler::<T, Access, Auth>),
        )
        .route(
            "/{session_id}/log",
            get(get_agent_session_log_handler::<T, Access, Auth>),
        )
        .with_state(state)
}

/// Build the agent session control router, mounted under the same prefix as
/// [`agent_session_read_router`].
///
/// Only mountable in the process that owns the sessions: every route here
/// reaches a live transport, which is in-memory state.
pub fn agent_session_control_router<R, Access, Auth, S>(
    state: AgentSessionControlState<R, Access, Auth>,
) -> Router<S>
where
    R: AgentSessionNotificationRecipient,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/{session_id}",
            delete(delete_agent_session_handler::<R, Access, Auth>),
        )
        .route(
            "/{session_id}/control",
            post(control_agent_session_handler::<R, Access, Auth>),
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

/// Request body for a control operation on a live session.
///
/// A wrapper around the operation rather than the bare enum so that fields
/// which are about the request rather than the operation have somewhere to go.
/// The acting user is deliberately not one of them: it comes from the caller's
/// credentials, so that a caller cannot attribute an operation to someone else.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ControlRequest {
    /// The operation to perform.
    #[serde(flatten)]
    pub action: AgentAction,
}

/// Response body describing an agent session.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionResponse {
    /// The session id.
    pub id: Uuid,
    /// The user who created and owns the session.
    pub owner_id: String,
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
            owner_id: session.owner_id.to_string(),
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
#[tracing::instrument(skip_all, fields(session_id = %session_id), err(Debug))]
pub async fn get_agent_session_handler<
    T: AgentSessionService,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    _access: AgentSessionAccessLevelExtractor<ViewAccessLevel, Access, Auth>,
    State(state): State<AgentSessionRouterState<T, Access, Auth>>,
    Path(session_id): Path<Uuid>,
) -> Result<Json<AgentSessionResponse>, AgentSessionApiError> {
    let session = state
        .service
        .get_session(AgentSessionId::new_from_uuid(session_id))
        .await?;

    Ok(Json(session.into()))
}

#[utoipa::path(
    post,
    path = "/agent-sessions/{session_id}/control",
    tag = "agent-sessions",
    operation_id = "control_agent_session",
    params(("session_id" = Uuid, Path, description = "ID of the agent session")),
    request_body = ControlRequest,
    responses(
        (
            status = 200,
            body = AgentActionId,
            description = "Accepted; matches `requestId` on the folded message this action derives"
        ),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 500, body = String),
    )
)]
/// Perform a control operation on a live agent session.
#[tracing::instrument(
    skip_all,
    fields(actor = %caller.acting_entity(), session_id = %session_id),
    err(Debug)
)]
pub async fn control_agent_session_handler<
    R: AgentSessionNotificationRecipient,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    _access: AgentSessionAccessLevelExtractor<OwnerAccessLevel, Access, Auth>,
    State(state): State<AgentSessionControlState<R, Access, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, UserOrBot>,
    Path(session_id): Path<Uuid>,
    Json(req): Json<ControlRequest>,
) -> Result<Json<AgentActionId>, AgentSessionApiError> {
    let actor = caller
        .authorization
        .acting_user()
        .map(|user| user.macro_user_id.clone());

    let action_id = state
        .recipient
        .control_event(
            AgentSessionId::new_from_uuid(session_id),
            ControlEvent {
                action: req.action,
                actor,
            },
        )
        .await?;

    Ok(Json(action_id))
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
/// Delete an agent session and its live resources.
#[tracing::instrument(skip_all, fields(session_id = %session_id), err(Debug))]
pub async fn delete_agent_session_handler<
    R: AgentSessionNotificationRecipient,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    _access: AgentSessionAccessLevelExtractor<OwnerAccessLevel, Access, Auth>,
    State(state): State<AgentSessionControlState<R, Access, Auth>>,
    Path(session_id): Path<Uuid>,
) -> Result<StatusCode, AgentSessionApiError> {
    state
        .recipient
        .session_deleted(AgentSessionId::new_from_uuid(session_id))
        .await?;

    Ok(StatusCode::OK)
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
    /// When the log recorded the frame.
    ///
    /// The frame itself carries no time, so this comes from the log row. It is
    /// what a reader has to order these against anything else it is showing
    /// beside them - the fold derives an order among the messages of one
    /// session and nothing more.
    #[serde(rename = "createdAt")]
    pub created_at: DateTime<Utc>,
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

impl From<StoredAgentSessionLog> for AgentSessionLogEntryDto {
    fn from(stored: StoredAgentSessionLog) -> Self {
        Self {
            created_at: stored.created_at,
            user_id: stored.entry.user_id.map(|user| user.to_string()),
            message: stored.entry.content,
        }
    }
}

/// Response body for one session's raw protocol log.
///
/// A wrapper rather than a bare array so that anything which is about the
/// response rather than about a frame has somewhere to go later without
/// breaking every client.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionLogResponse {
    /// The agent whose messages the log derives.
    ///
    /// Here because a client renders those messages and cannot otherwise work
    /// out who sent them: the sender of an agent message is this session's
    /// bot, and nothing else names it.
    pub bot: SessionBot,
    /// Every logged frame, oldest first. Folding depends on this order.
    pub entries: Vec<AgentSessionLogEntryDto>,
}

#[utoipa::path(
    get,
    path = "/agent-sessions/{session_id}/log",
    tag = "agent-sessions",
    operation_id = "get_agent_session_log",
    params(("session_id" = Uuid, Path, description = "ID of the agent session")),
    responses(
        (status = 200, body = AgentSessionLogResponse),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 500, body = String),
    )
)]
/// The raw protocol log of one agent session.
///
/// Served unfolded, and whole: the fold is a left fold over the frames from
/// the beginning, so a reader that skipped any of them would derive different
/// turn numbering.
///
/// An unknown session is an error: the response has to name the session's
/// agent, and a session that never existed has none to name.
#[tracing::instrument(skip_all, fields(session_id = %session_id), err(Debug))]
pub async fn get_agent_session_log_handler<
    T: AgentSessionService,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    _access: AgentSessionAccessLevelExtractor<ViewAccessLevel, Access, Auth>,
    State(state): State<AgentSessionRouterState<T, Access, Auth>>,
    Path(session_id): Path<Uuid>,
) -> Result<Json<AgentSessionLogResponse>, AgentSessionApiError> {
    let log = state
        .service
        .session_log(AgentSessionId::new_from_uuid(session_id))
        .await?;

    Ok(Json(AgentSessionLogResponse {
        bot: log.bot,
        entries: log.entries.into_iter().map(Into::into).collect(),
    }))
}
