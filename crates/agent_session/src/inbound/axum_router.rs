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

use agent_fold::domain::model::{
    Author, FileDiff, FoldedMessage, MessagePart, Permission, PermissionOption, PermissionOutcome,
    StopReason, ToolDetail, ToolStatus, ToolUse,
};

use crate::domain::error::AgentSessionError;
use crate::domain::model::{
    AgentSession, AgentSessionId, ChannelFoldedMessages, SessionStatus, composite_message_id,
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
            "/channel/{channel_id}/messages",
            get(get_agent_channel_messages_handler::<T, Auth>),
        )
        .with_state(state)
}

/// Transport error for agent session handlers.
#[derive(Debug)]
pub enum AgentSessionApiError {
    /// No agent session owns the addressed channel.
    NoSessionForChannel,
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
            Self::NoSessionForChannel => {
                (StatusCode::NOT_FOUND, "no agent session owns this channel").into_response()
            }
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

/// Response body for a channel's folded agent-session messages.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentChannelMessagesResponse {
    /// The session whose log derived the messages.
    pub agent_session_id: Uuid,
    /// The session's folded messages, oldest first.
    pub messages: Vec<FoldedMessageDto>,
}

impl From<ChannelFoldedMessages> for AgentChannelMessagesResponse {
    fn from(folded: ChannelFoldedMessages) -> Self {
        let session = folded.agent_session_id;
        Self {
            agent_session_id: session.as_uuid(),
            messages: folded
                .messages
                .into_iter()
                .map(|message| FoldedMessageDto::new(session, message))
                .collect(),
        }
    }
}

/// One renderable message folded from a session's protocol log, mirroring
/// [`FoldedMessage`].
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FoldedMessageDto {
    /// The composite id the placeholder comms message for this folded message
    /// carries in its `agent_session_message_id`:
    /// `"{agent_session_id}:{turn}:{author}"`. Readers join folded messages
    /// onto placeholder rows by this, one to one.
    pub agent_session_message_id: String,
    /// The turn within the session, assigned in log order from zero.
    pub turn: u32,
    /// Who produced the message.
    pub author: FoldedAuthorDto,
    /// Ordered renderable content. Never empty.
    pub parts: Vec<FoldedMessagePartDto>,
    /// How the turn ended, on the agent message that closed it. Absent while
    /// the turn is in flight or when the session died without a response.
    pub stop: Option<StopReasonDto>,
}

impl FoldedMessageDto {
    /// Map a folded message into its transport shape, stamping the composite
    /// message id of the session it was folded from.
    fn new(session: AgentSessionId, message: FoldedMessage) -> Self {
        Self {
            agent_session_message_id: composite_message_id(session, message.id()),
            turn: message.id.0,
            author: message.author.into(),
            parts: message
                .parts
                .into_inner()
                .into_iter()
                .map(Into::into)
                .collect(),
            stop: message.stop.map(Into::into),
        }
    }
}

/// Who produced a folded message, mirroring [`Author`].
///
/// Multi-word fields in these enums carry explicit `#[serde(rename)]`s
/// instead of `rename_all_fields = "camelCase"`: utoipa does not read
/// `rename_all_fields`, so the explicit form keeps the generated schema and
/// the serialized wire format in agreement.
#[derive(Debug, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FoldedAuthorDto {
    /// A person, via `session/prompt`.
    User {
        /// The user's macro id, absent when the prompt was unattributed.
        #[serde(rename = "userId")]
        user_id: Option<String>,
    },
    /// The agent.
    Agent,
}

impl From<Author> for FoldedAuthorDto {
    fn from(author: Author) -> Self {
        match author {
            Author::User(user_id) => Self::User {
                user_id: user_id.map(|id| id.to_string()),
            },
            Author::Agent => Self::Agent,
        }
    }
}

/// A unit of renderable content, mirroring [`MessagePart`].
#[derive(Debug, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FoldedMessagePartDto {
    /// Prose from the user or the agent.
    Text {
        /// The prose.
        text: String,
    },
    /// The agent's reasoning, which a reader may want to hide by default.
    Thought {
        /// The reasoning.
        text: String,
    },
    /// A tool the agent invoked.
    ToolUse {
        /// The ACP `toolCallId`.
        id: String,
        /// What to show as the tool's name.
        label: String,
        /// Where the call got to.
        status: ToolStatusDto,
        /// What the tool did, as far as the log reveals.
        detail: ToolDetailDto,
    },
    /// The agent asking to proceed with a tool call.
    Permission {
        /// The `toolCallId` permission was requested for.
        #[serde(rename = "toolCall")]
        tool_call: String,
        /// The choices offered, in the order ACP listed them.
        options: Vec<PermissionOptionDto>,
        /// What the user chose. Absent while the request is outstanding, or
        /// when the session ended before anyone answered.
        outcome: Option<PermissionOutcomeDto>,
    },
}

impl From<MessagePart> for FoldedMessagePartDto {
    fn from(part: MessagePart) -> Self {
        match part {
            MessagePart::Text(text) => Self::Text { text },
            MessagePart::Thought(text) => Self::Thought { text },
            MessagePart::ToolUse(ToolUse {
                id,
                label,
                status,
                detail,
            }) => Self::ToolUse {
                id: id.0,
                label,
                status: status.into(),
                detail: detail.into(),
            },
            MessagePart::Permission(Permission {
                tool_call,
                options,
                outcome,
            }) => Self::Permission {
                tool_call: tool_call.0,
                options: options.into_iter().map(Into::into).collect(),
                outcome: outcome.map(Into::into),
            },
        }
    }
}

/// How far a tool call progressed, mirroring [`ToolStatus`].
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ToolStatusDto {
    /// Not started - still streaming input or awaiting permission.
    Pending,
    /// Currently running.
    Running,
    /// Finished successfully.
    Completed,
    /// Finished unsuccessfully.
    Failed,
}

impl From<ToolStatus> for ToolStatusDto {
    fn from(status: ToolStatus) -> Self {
        match status {
            ToolStatus::Pending => Self::Pending,
            ToolStatus::Running => Self::Running,
            ToolStatus::Completed => Self::Completed,
            ToolStatus::Failed => Self::Failed,
        }
    }
}

/// What a tool call actually did, mirroring [`ToolDetail`].
#[derive(Debug, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ToolDetailDto {
    /// A shell command.
    Terminal {
        /// The command line, when the harness reported one.
        command: Option<String>,
        /// Captured output, ANSI escape sequences left in place.
        output: Option<String>,
        /// Process exit code, when the harness reported one.
        #[serde(rename = "exitCode")]
        exit_code: Option<i32>,
    },
    /// One or more file modifications.
    Edit {
        /// The diffs ACP reported for this call.
        diffs: Vec<FileDiffDto>,
    },
    /// A file read.
    Read {
        /// Paths this call touched.
        paths: Vec<String>,
    },
    /// Anything else, including tools the fold has no special rendering for.
    Other {
        /// ACP's tool kind, as its wire string.
        #[serde(rename = "acpKind")]
        acp_kind: String,
        /// The tool's input, when reported.
        #[schema(value_type = Option<Object>)]
        input: Option<serde_json::Value>,
    },
}

impl From<ToolDetail> for ToolDetailDto {
    fn from(detail: ToolDetail) -> Self {
        match detail {
            ToolDetail::Terminal {
                command,
                output,
                exit_code,
            } => Self::Terminal {
                command,
                output: output.map(|output| output.as_str().to_owned()),
                exit_code,
            },
            ToolDetail::Edit { diffs } => Self::Edit {
                diffs: diffs.into_iter().map(Into::into).collect(),
            },
            ToolDetail::Read { paths } => Self::Read {
                paths: paths
                    .into_iter()
                    .map(|path| path.to_string_lossy().into_owned())
                    .collect(),
            },
            ToolDetail::Other { kind, input } => Self::Other {
                acp_kind: kind,
                input,
            },
        }
    }
}

/// A file modification a tool reported, mirroring [`FileDiff`].
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FileDiffDto {
    /// The file that changed.
    pub path: String,
    /// Prior contents, absent when the file is new.
    pub old_text: Option<String>,
    /// New contents.
    pub new_text: String,
}

impl From<FileDiff> for FileDiffDto {
    fn from(diff: FileDiff) -> Self {
        Self {
            path: diff.path.to_string_lossy().into_owned(),
            old_text: diff.old_text,
            new_text: diff.new_text,
        }
    }
}

/// One choice offered for a permission request, mirroring
/// [`PermissionOption`].
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PermissionOptionDto {
    /// The id to report back when this option is chosen.
    pub id: String,
    /// Label to show.
    pub name: String,
    /// ACP's option kind, as its wire string - `allow_once`, `reject_once`,
    /// `allow_always`, `reject_always`.
    pub kind: String,
}

impl From<PermissionOption> for PermissionOptionDto {
    fn from(option: PermissionOption) -> Self {
        Self {
            id: option.id,
            name: option.name,
            kind: option.kind,
        }
    }
}

/// How a permission request resolved, mirroring [`PermissionOutcome`].
#[derive(Debug, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PermissionOutcomeDto {
    /// An option was chosen.
    Selected {
        /// The chosen option's id.
        #[serde(rename = "optionId")]
        option_id: String,
    },
    /// The request was cancelled without a choice.
    Cancelled,
}

impl From<PermissionOutcome> for PermissionOutcomeDto {
    fn from(outcome: PermissionOutcome) -> Self {
        match outcome {
            PermissionOutcome::Selected { option_id } => Self::Selected { option_id },
            PermissionOutcome::Cancelled => Self::Cancelled,
        }
    }
}

/// Why a turn stopped, mirroring [`StopReason`].
#[derive(Debug, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StopReasonDto {
    /// The agent finished its turn.
    EndTurn,
    /// The model hit its token limit.
    MaxTokens,
    /// The agent hit its turn-request limit.
    MaxTurnRequests,
    /// The agent declined.
    Refusal,
    /// The turn was cancelled.
    Cancelled,
    /// A stop reason the fold does not model.
    Other {
        /// The wire string.
        reason: String,
    },
}

impl From<StopReason> for StopReasonDto {
    fn from(stop: StopReason) -> Self {
        match stop {
            StopReason::EndTurn => Self::EndTurn,
            StopReason::MaxTokens => Self::MaxTokens,
            StopReason::MaxTurnRequests => Self::MaxTurnRequests,
            StopReason::Refusal => Self::Refusal,
            StopReason::Cancelled => Self::Cancelled,
            StopReason::Other(reason) => Self::Other { reason },
        }
    }
}

#[utoipa::path(
    get,
    path = "/agent-sessions/channel/{channel_id}/messages",
    tag = "agent-sessions",
    operation_id = "get_agent_channel_messages",
    params(("channel_id" = Uuid, Path, description = "ID of the session's dedicated channel")),
    responses(
        (status = 200, body = AgentChannelMessagesResponse),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
/// The folded messages of the agent session behind a channel.
///
/// Placeholder comms messages in an agent channel store no body, only an
/// `agent_session_message_id`; each message here carries the same composite id,
/// so a reader joins the two to render the channel. `404` when no agent
/// session owns the channel.
#[tracing::instrument(
    skip(state, caller),
    fields(actor = %caller.acting_entity(), channel_id = %channel_id),
    err(Debug)
)]
pub async fn get_agent_channel_messages_handler<
    T: AgentSessionService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<AgentSessionRouterState<T, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, UserOrBot>,
    Path(channel_id): Path<Uuid>,
) -> Result<Json<AgentChannelMessagesResponse>, AgentSessionApiError> {
    let folded = state
        .service
        .channel_messages(channel_id)
        .await?
        .ok_or(AgentSessionApiError::NoSessionForChannel)?;

    Ok(Json(folded.into()))
}
