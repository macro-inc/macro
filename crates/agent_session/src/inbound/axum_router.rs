//! Axum router and HTTP handlers exposing the agent session service.
//!
//! Every route authenticates its caller and then authorizes them with
//! [`AgentSessionAccessLevelExtractor`], checked before the handler body
//! runs: viewing a session or its log needs `View`; renaming, controlling, or
//! deleting one needs `Owner`. Permission comes from the session's own `entity_access`
//! rows - the owner with owner access, the mention's channel as editor - never
//! from any channel the session was once rendered in. Handlers only map
//! transport DTOs to domain types and call the [`AgentSessionService`]; they
//! make no authorization or business decisions of their own.
//!
//! The one exception is session creation: there is no session yet to resolve
//! access against, so `create_agent_session_handler` gates on the bot's own
//! facts - ownership, agent-hood, managedness - through [`BotDirectory`].

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
    routing::{delete, get, post, put},
};
use chrono::DateTime;
use chrono::Utc;
use entity_access::domain::models::{OwnerAccessLevel, ViewAccessLevel};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::AgentSessionAccessLevelExtractor;
use macro_authorization::{
    ActingUser, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
    UserOrBot, UserOrBotAuthorization,
};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::domain::error::AgentSessionError;
use crate::domain::model::{
    AgentSession, AgentSessionId, ExternalSession, Message, SandboxSize, SessionBot, SessionStatus,
    StoredAgentSessionLog,
};
use crate::domain::ports::{
    AgentSessionNotificationRecipient, BotDirectory, BotFacts, ControlEvent,
    OpenExternalAgentSession, OpenManagedSession, SessionOpener, SessionThread,
};
use crate::domain::service::AgentSessionService;
use bots::domain::models::BotId;

#[cfg(test)]
mod test;

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
        .route(
            "/{session_id}/name",
            put(rename_agent_session_handler::<T, Access, Auth>),
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
        .route(
            "/{session_id}/sandbox-size",
            put(put_agent_session_sandbox_size_handler::<R, Access, Auth>),
        )
        .with_state(state)
}

/// Build the caller-default sandbox size router. Mount at `/agent-sandbox-size`.
pub fn agent_sandbox_size_router<T, Access, Auth, S>(
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
            "/agent-sandbox-size",
            get(get_agent_sandbox_size_handler::<T, Access, Auth>)
                .put(put_agent_sandbox_size_handler::<T, Access, Auth>),
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
            // A session whose runtime is not attached is the everyday state of
            // a self-hosted agent: the operator's daemon dials on a trigger and
            // its bridge ends when the session goes quiet. Nothing is wrong
            // here, and nothing the caller does again right now will land, so it
            // answers 409 with a reason rather than a 500 that reads as a bug
            // and buries the one fact worth showing a user.
            Self::Domain(AgentSessionError::Disconnected(session_id)) => {
                tracing::info!(%session_id, "action refused: the session's runtime is not connected");
                (
                    StatusCode::CONFLICT,
                    "the agent's runtime is not connected to this session",
                )
                    .into_response()
            }
            Self::Domain(AgentSessionError::Forbidden) => {
                (StatusCode::FORBIDDEN, "forbidden").into_response()
            }
            Self::Domain(error) => {
                if let AgentSessionError::InvalidName(message) = error {
                    return (StatusCode::BAD_REQUEST, Json(message)).into_response();
                }
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

/// Request body for renaming an agent session.
#[derive(Debug, Deserialize, ToSchema)]
pub struct RenameAgentSessionRequest {
    /// New user-facing name. Leading and trailing whitespace is discarded.
    pub name: String,
}

/// Request body for a control operation on a live session.
///
/// A wrapper around the operation rather than the bare enum so that fields
/// which are about the request rather than the operation have somewhere to go.
/// The acting user is deliberately not one of them: it comes from the caller's
/// credentials, so that a caller cannot attribute an operation to someone else.
///
/// Clients serialize this, so both derives are used.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ControlRequest {
    /// The operation to perform.
    #[serde(flatten)]
    pub action: AgentAction,
}

/// Response body describing an agent session.
///
/// Clients deserialize this, so both derives are used.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionResponse {
    /// The session id.
    pub id: Uuid,
    /// User-facing session name.
    pub name: String,
    /// The user who created and owns the session.
    pub owner_id: String,
    /// The root message of the thread the session was created from, if any.
    pub thread_id: Option<Uuid>,
    /// The channel `thread_id` lives in, when the session was spawned from a
    /// thread.
    pub thread_channel_id: Option<Uuid>,
    /// The exact message that invoked the bot, if any.
    pub originating_message_id: Option<Uuid>,
    /// The bot running the agent.
    pub bot_id: Uuid,
    /// Model slug.
    pub model: String,
    /// Harness slug.
    pub harness: String,
    /// The repository the session works with, when one was stated.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_url: Option<String>,
    /// The directory the session's harness runs in on its runtime.
    pub workspace: String,
    /// Compute tier of the managed sandbox.
    pub sandbox_size: SandboxSize,
    /// Instructions the session's runtime works under, when any were stated
    /// at creation. Absent otherwise, so existing payloads are unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
    /// The ACP session id, if one exists.
    pub acp_session_id: Option<String>,
    /// The session's status.
    pub status: SessionStatusDto,
    /// The external provider serving this session, when one does. Absent for
    /// sandboxed sessions, so existing payloads are byte-identical.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external: Option<ExternalSessionResponse>,
    /// When the session was created.
    pub created_at: DateTime<Utc>,
    /// When the session was last modified.
    pub modified_at: DateTime<Utc>,
}

/// The provider-side identity of an externally-served session.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExternalSessionResponse {
    /// Which provider serves the session, e.g. `cursor`.
    pub provider: String,
    /// The provider's display name for the agent, when it reported one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The agent's page on the provider's site, for a client to link out to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

impl From<ExternalSession> for ExternalSessionResponse {
    fn from(external: ExternalSession) -> Self {
        Self {
            provider: external.provider,
            name: external.external_name,
            url: external.external_url,
        }
    }
}

impl From<AgentSession> for AgentSessionResponse {
    fn from(session: AgentSession) -> Self {
        Self {
            id: session.id.as_uuid(),
            name: session.name,
            owner_id: session.owner_id.to_string(),
            thread_id: session.thread_id,
            thread_channel_id: session.thread_channel_id,
            originating_message_id: session.originating_message_id,
            bot_id: session.bot_id.as_uuid(),
            model: session.model,
            harness: session.harness,
            repo_url: session.repo_url,
            workspace: session.workspace,
            sandbox_size: session.sandbox_size,
            instructions: session.instructions,
            acp_session_id: session.acp_session_id.map(|id| id.to_string()),
            external: session.external.map(Into::into),
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
    put,
    path = "/agent-sessions/{session_id}/name",
    tag = "agent-sessions",
    operation_id = "rename_agent_session",
    params(("session_id" = Uuid, Path, description = "ID of the agent session")),
    request_body = RenameAgentSessionRequest,
    responses(
        (status = 204),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 500, body = String),
    )
)]
/// Rename an agent session.
#[tracing::instrument(skip_all, fields(session_id = %session_id), err(Debug))]
pub async fn rename_agent_session_handler<
    T: AgentSessionService,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: AgentSessionAccessLevelExtractor<OwnerAccessLevel, Access, Auth>,
    State(state): State<AgentSessionRouterState<T, Access, Auth>>,
    Path(session_id): Path<Uuid>,
    Json(request): Json<RenameAgentSessionRequest>,
) -> Result<StatusCode, AgentSessionApiError> {
    state
        .service
        .rename_session(&access.entity_access_receipt, &request.name)
        .await?;
    Ok(StatusCode::NO_CONTENT)
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
    fields(
        actor = %caller.acting_entity(),
        session_id = %session_id,
        agent.action.name = req.action.as_ref(),
    ),
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

/// Request or response body for a named sandbox size.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SandboxSizeBody {
    /// Named compute tier.
    pub size: SandboxSize,
}

#[utoipa::path(
    put,
    path = "/agent-sessions/{session_id}/sandbox-size",
    tag = "agent-sessions",
    operation_id = "put_agent_session_sandbox_size",
    params(("session_id" = Uuid, Path, description = "ID of the agent session")),
    request_body = SandboxSizeBody,
    responses(
        (status = 200, body = SandboxSizeBody),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 500, body = String),
    )
)]
/// Resize this session's sandbox and remember the size as the owner's default.
#[tracing::instrument(skip_all, fields(session_id = %session_id, size = %req.size), err(Debug))]
pub async fn put_agent_session_sandbox_size_handler<
    R: AgentSessionNotificationRecipient,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    _access: AgentSessionAccessLevelExtractor<OwnerAccessLevel, Access, Auth>,
    State(state): State<AgentSessionControlState<R, Access, Auth>>,
    Path(session_id): Path<Uuid>,
    Json(req): Json<SandboxSizeBody>,
) -> Result<Json<SandboxSizeBody>, AgentSessionApiError> {
    state
        .recipient
        .set_sandbox_size(AgentSessionId::new_from_uuid(session_id), req.size)
        .await?;
    Ok(Json(req))
}

#[utoipa::path(
    get,
    path = "/agent-sandbox-size",
    tag = "agent-sessions",
    operation_id = "get_agent_sandbox_size",
    responses(
        (status = 200, body = SandboxSizeBody),
        (status = 401, body = String),
        (status = 500, body = String),
    )
)]
/// Read the caller's default sandbox size for new `@coder` sessions.
#[tracing::instrument(skip_all, fields(actor = %caller.acting_entity()), err(Debug))]
pub async fn get_agent_sandbox_size_handler<
    T: AgentSessionService,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<AgentSessionRouterState<T, Access, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, ActingUser>,
) -> Result<Json<SandboxSizeBody>, AgentSessionApiError> {
    let size = state
        .service
        .user_sandbox_size(&caller.authorization.user.macro_user_id)
        .await?;
    Ok(Json(SandboxSizeBody { size }))
}

#[utoipa::path(
    put,
    path = "/agent-sandbox-size",
    tag = "agent-sessions",
    operation_id = "put_agent_sandbox_size",
    request_body = SandboxSizeBody,
    responses(
        (status = 200, body = SandboxSizeBody),
        (status = 401, body = String),
        (status = 500, body = String),
    )
)]
/// Set the caller's default sandbox size for the next `@coder` mention.
#[tracing::instrument(
    skip_all,
    fields(actor = %caller.acting_entity(), size = %req.size),
    err(Debug)
)]
pub async fn put_agent_sandbox_size_handler<
    T: AgentSessionService,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<AgentSessionRouterState<T, Access, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, ActingUser>,
    Json(req): Json<SandboxSizeBody>,
) -> Result<Json<SandboxSizeBody>, AgentSessionApiError> {
    state
        .service
        .set_user_sandbox_size(&caller.authorization.user.macro_user_id, req.size)
        .await?;
    Ok(Json(req))
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

/// Shared state for the create route: the opener that owns session-opening
/// semantics, the bot directory that gates it, and the authorization state the
/// extractor runs against.
///
/// Nothing about the gateway: a runtime dials once per bot, at an address its
/// own configuration names, so creating a session says nothing about where to
/// connect.
pub struct CreateSessionState<Opener, Bots, Auth> {
    opener: Arc<Opener>,
    bots: Arc<Bots>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<Opener, Bots, Auth> CreateSessionState<Opener, Bots, Auth> {
    /// Create route state.
    pub fn new(
        opener: Arc<Opener>,
        bots: Arc<Bots>,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            opener,
            bots,
            authorization_state,
        }
    }
}

// Manual Clone impl so Opener and Bots don't need to be Clone (both are
// behind Arcs).
impl<Opener, Bots, Auth> Clone for CreateSessionState<Opener, Bots, Auth> {
    fn clone(&self) -> Self {
        Self {
            opener: Arc::clone(&self.opener),
            bots: Arc::clone(&self.bots),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Opener, Bots, Auth> FromRef<CreateSessionState<Opener, Bots, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &CreateSessionState<Opener, Bots, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the router serving `POST /agent-sessions`. Mount it under the same
/// prefix as [`agent_session_read_router`] and [`agent_session_control_router`].
pub fn agent_session_create_router<Opener, Bots, Auth, S>(
    state: CreateSessionState<Opener, Bots, Auth>,
) -> Router<S>
where
    Opener: SessionOpener,
    Bots: BotDirectory,
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/",
            post(create_agent_session_handler::<Opener, Bots, Auth>),
        )
        .with_state(state)
}

/// Request body for `POST /agent-sessions`.
///
/// Carries two shapes, told apart by `workspace`. Naming one asks for an
/// external session: the runtime is the bot operator's, so the caller has to
/// say which bot and which directory, and must own that bot. Omitting it asks
/// for a managed session, whose sandbox this deployment provisions from its
/// own configuration - which is why the fields describing someone else's
/// runtime must be omitted along with it rather than quietly ignored. Mixing
/// the two is refused rather than guessed at, so that no request can reach the
/// managed path carrying a bot the caller was never entitled to name.
///
/// Clients serialize this, so both derives are used.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentSessionRequest {
    /// Bot the session runs for. Bot callers may omit it (their own identity
    /// is used) and must not name another bot; user callers must supply a
    /// bot they own. External sessions only: a managed session runs as the
    /// bot its deployment is configured for.
    pub bot_id: Option<Uuid>,
    /// Absolute directory the bot's harness runs in on its runtime. Present
    /// for an external session, absent for a managed one, which runs in the
    /// path baked into its image.
    pub workspace: Option<String>,
    /// First prompt to deliver once the session is running. Managed sessions
    /// only - an external runtime sends its own first prompt through the
    /// control endpoint. Omitted, the session opens idle.
    pub prompt: Option<String>,
    /// Repository nominally checked out at `workspace`. Informational and
    /// optional: having it cloned there is the runtime operator's job.
    pub repo_url: Option<String>,
    /// The user who owns the session. Ignored for user callers, who always
    /// own their own sessions; required for bot callers without verified
    /// acting-user claims.
    ///
    /// For bot callers this is a claim, not a verified fact: it is scoped to
    /// the bot's own sessions, but the named user owns the session on the
    /// bot's say-so.
    pub owner: Option<String>,
    /// The thread whose mention triggered the session, when one did.
    /// Linkage only - the mention's text is delivered by the runtime as the
    /// first prompt through the control endpoint, never through here.
    pub thread: Option<CreateSessionThread>,
    /// Instructions the session's runtime works under, for its whole life.
    ///
    /// Recorded on the session whichever runtime serves it. Only the
    /// in-process one acts on them today; `agent_harness`'s `AgentKind`
    /// records what each of the others will need to.
    pub instructions: Option<String>,
}

/// The triggering mention on a create request.
///
/// Clients serialize this, so both derives are used.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionThread {
    /// Channel the mentioning message was posted in.
    pub channel_id: Uuid,
    /// Thread the session belongs to; defaults to the message itself, which
    /// is how a top-level mention roots its own thread.
    pub thread_id: Option<Uuid>,
    /// The mentioning message.
    pub message_id: Uuid,
    /// The mention's text, quoted in the session's announcement.
    #[serde(default)]
    pub content: String,
}

/// Response body for `POST /agent-sessions`.
///
/// Clients deserialize this, so both derives are used.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentSessionResponse {
    /// The created session.
    pub session: AgentSessionResponse,
}

/// What the 409 from `POST /agent-sessions` says when a thread already
/// routes to a session.
const THREAD_SESSION_EXISTS_MESSAGE: &str = "this bot already has a session for this thread";

/// Body of the 409 answered by `POST /agent-sessions` when the request's
/// thread already routes to one of this bot's sessions.
///
/// Clients deserialize this, so both derives are used.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSessionExistsResponse {
    /// Human-readable explanation.
    pub message: String,
    /// The session the thread already routes to, when it could be resolved.
    #[serde(default)]
    #[schema(value_type = Option<String>)]
    pub session_id: Option<AgentSessionId>,
}

/// Transport error for the create route.
#[derive(Debug)]
pub enum CreateSessionApiError {
    /// The request named no usable bot.
    BotRequired,
    /// The named bot does not exist.
    UnknownBot,
    /// The caller may not open sessions for this bot.
    NotYourBot,
    /// The bot is not an agent bot.
    NotAnAgentBot,
    /// The bot's sessions are opened by the trigger pipeline, not this route.
    ManagedBot,
    /// The caller identified no user to own the session.
    OwnerRequired,
    /// The owner is not a parseable user id.
    UnparseableOwner,
    /// The workspace is not an acceptable path.
    InvalidWorkspace(&'static str),
    /// The request mixed the managed and external shapes.
    MixedSessionShape,
    /// The thread already routes to a session; carries it for recovery.
    ThreadSessionExists {
        /// The existing session, when it could be resolved.
        session_id: Option<AgentSessionId>,
    },
    /// The domain rejected the open.
    Domain(AgentSessionError),
}

impl From<AgentSessionError> for CreateSessionApiError {
    fn from(error: AgentSessionError) -> Self {
        Self::Domain(error)
    }
}

impl IntoResponse for CreateSessionApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::BotRequired => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "botId is required for user callers".to_owned(),
            ),
            Self::UnknownBot => (StatusCode::NOT_FOUND, "no such bot".to_owned()),
            Self::NotYourBot => (
                StatusCode::FORBIDDEN,
                "you may not open sessions for this bot".to_owned(),
            ),
            Self::NotAnAgentBot => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "this bot does not run an agent".to_owned(),
            ),
            Self::ManagedBot => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "this bot's sessions are opened by the trigger pipeline".to_owned(),
            ),
            Self::OwnerRequired => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "owner is required for bot callers".to_owned(),
            ),
            Self::UnparseableOwner => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "owner is not a user id".to_owned(),
            ),
            Self::InvalidWorkspace(reason) => (StatusCode::UNPROCESSABLE_ENTITY, reason.to_owned()),
            Self::MixedSessionShape => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "a managed session takes only a prompt; naming a workspace, bot, repo, \
                 owner or thread asks for an external one"
                    .to_owned(),
            ),
            Self::ThreadSessionExists { session_id } => {
                let body = ThreadSessionExistsResponse {
                    message: THREAD_SESSION_EXISTS_MESSAGE.to_owned(),
                    session_id,
                };
                return (StatusCode::CONFLICT, Json(body)).into_response();
            }
            Self::Domain(AgentSessionError::ThreadSessionExists) => (
                StatusCode::CONFLICT,
                "this bot already has a session for this thread".to_owned(),
            ),
            Self::Domain(AgentSessionError::UnknownOwner) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "owner is not a known user".to_owned(),
            ),
            Self::Domain(error) => {
                tracing::error!(error = ?error, "failed to open an agent session");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "failed to open the session".to_owned(),
                )
            }
        };
        (status, message).into_response()
    }
}

/// Reject paths a harness cannot meaningfully run in. Rejection over
/// normalization: a runtime that sends a relative path is confused about its
/// own filesystem, and no server-side guess fixes that.
fn validate_workspace(workspace: &str) -> Result<(), CreateSessionApiError> {
    if !workspace.starts_with('/') {
        return Err(CreateSessionApiError::InvalidWorkspace(
            "workspace must be an absolute path",
        ));
    }
    if workspace.len() > 4096 {
        return Err(CreateSessionApiError::InvalidWorkspace(
            "workspace is too long",
        ));
    }
    if workspace.contains('\0') {
        return Err(CreateSessionApiError::InvalidWorkspace(
            "workspace must not contain NUL",
        ));
    }
    if workspace.len() > 1 && workspace.ends_with('/') {
        return Err(CreateSessionApiError::InvalidWorkspace(
            "workspace must not end with a slash",
        ));
    }
    Ok(())
}

/// Resolve which bot the session runs for, from the principal and the body.
fn resolve_bot(
    caller: &UserOrBotAuthorization,
    body_bot: Option<Uuid>,
) -> Result<BotId, CreateSessionApiError> {
    match caller {
        UserOrBotAuthorization::Bot(bot) => match body_bot {
            Some(named) if named != bot.bot_id.as_uuid() => Err(CreateSessionApiError::NotYourBot),
            _ => Ok(bot.bot_id),
        },
        UserOrBotAuthorization::User(_) => body_bot
            .map(BotId::new_from_uuid)
            .ok_or(CreateSessionApiError::BotRequired),
    }
}

/// Resolve the user who owns the session.
///
/// A user caller always owns their own sessions. A bot caller's verified
/// acting user wins when present; otherwise the body's claimed owner is
/// accepted (see [`CreateAgentSessionRequest::owner`] for the trust model).
fn resolve_owner(
    caller: &UserOrBotAuthorization,
    claimed: Option<String>,
) -> Result<MacroUserIdStr<'static>, CreateSessionApiError> {
    if let Some(user) = caller.acting_user() {
        return Ok(user.macro_user_id.clone());
    }
    let claimed = claimed.ok_or(CreateSessionApiError::OwnerRequired)?;
    MacroUserIdStr::try_from(claimed).map_err(|_| CreateSessionApiError::UnparseableOwner)
}

#[utoipa::path(
    post,
    path = "/agent-sessions",
    tag = "agent-sessions",
    operation_id = "create_agent_session",
    request_body = CreateAgentSessionRequest,
    responses(
        (status = 201, body = CreateAgentSessionResponse),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 404, body = String),
        (status = 422, body = String),
        (status = 500, body = String),
    )
)]
/// Open an agent session served by an external runtime.
///
/// Nothing here tells the runtime where to dial: one connection per bot
/// carries every session it runs, so a runtime that has already dialed serves
/// this session too, and one that has not dials the gateway its own
/// configuration names. The triggering mention reaches the session as its
/// first prompt through the control endpoint.
#[tracing::instrument(skip_all, err(Debug))]
pub async fn create_agent_session_handler<
    Opener: SessionOpener,
    Bots: BotDirectory,
    Auth: MacroAuthorizationService,
>(
    State(state): State<CreateSessionState<Opener, Bots, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, UserOrBot>,
    Json(request): Json<CreateAgentSessionRequest>,
) -> Result<(StatusCode, Json<CreateAgentSessionResponse>), CreateSessionApiError> {
    // Blank instructions are "none" stated clumsily; normalized once here so
    // the row, the response and every runtime see one representation of
    // absence, whichever shape the request turns out to be.
    let instructions = request.instructions.filter(|text| !text.trim().is_empty());

    // No workspace means the managed shape. It shares this route but not its
    // authorization: nothing about which bot runs the session is the caller's
    // to say, so the bot-ownership checks below have nothing to check and are
    // skipped. That is only sound while the request carries none of the
    // external fields, which is what this refuses.
    let Some(workspace) = request.workspace else {
        if request.bot_id.is_some()
            || request.repo_url.is_some()
            || request.thread.is_some()
            || request.owner.is_some()
        {
            return Err(CreateSessionApiError::MixedSessionShape);
        }
        let owner = resolve_owner(&caller.authorization, None)?;
        let session = state
            .opener
            .open_managed_session(OpenManagedSession {
                owner,
                prompt: request.prompt,
                instructions,
            })
            .await?;
        return Ok((
            StatusCode::CREATED,
            Json(CreateAgentSessionResponse {
                session: session.into(),
            }),
        ));
    };

    // An external runtime sends its own first prompt through the control
    // endpoint, so accepting one here would silently drop it.
    if request.prompt.is_some() {
        return Err(CreateSessionApiError::MixedSessionShape);
    }
    let bot_id = resolve_bot(&caller.authorization, request.bot_id)?;

    let BotFacts {
        has_agent,
        is_managed,
        owner_user_id,
    } = state
        .bots
        .bot_facts(bot_id)
        .await?
        .ok_or(CreateSessionApiError::UnknownBot)?;
    if !has_agent {
        return Err(CreateSessionApiError::NotAnAgentBot);
    }
    if is_managed {
        return Err(CreateSessionApiError::ManagedBot);
    }
    // A team-owned bot has no owner_user_id, so no user token passes this
    // check: its sessions are opened with the bot's own token until team
    // membership is modeled here.
    if let UserOrBotAuthorization::User(user) = &caller.authorization
        && owner_user_id.as_ref() != Some(&user.macro_user_id)
    {
        return Err(CreateSessionApiError::NotYourBot);
    }

    validate_workspace(&workspace)?;
    let owner = resolve_owner(&caller.authorization, request.owner)?;

    let thread = request.thread.map(|thread| SessionThread {
        channel_id: thread.channel_id,
        thread_id: thread.thread_id.unwrap_or(thread.message_id),
        message_id: thread.message_id,
        content: thread.content,
    });
    let session = match state
        .opener
        .open_external_session(OpenExternalAgentSession {
            bot_id,
            workspace,
            repo_url: request.repo_url,
            owner,
            thread: thread.clone(),
            instructions,
        })
        .await
    {
        Ok(session) => session,
        // A conflicted open answers with the session the thread already
        // routes to, so a redelivered trigger can resume serving it
        // instead of being dropped.
        Err(AgentSessionError::ThreadSessionExists) => {
            let session_id = match thread {
                Some(thread) => state
                    .opener
                    .find_thread_session(thread.thread_id, bot_id)
                    .await
                    .unwrap_or_default(),
                None => None,
            };
            return Err(CreateSessionApiError::ThreadSessionExists { session_id });
        }
        Err(error) => return Err(error.into()),
    };

    Ok((
        StatusCode::CREATED,
        Json(CreateAgentSessionResponse {
            session: session.into(),
        }),
    ))
}
