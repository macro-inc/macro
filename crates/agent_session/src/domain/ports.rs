use agent_client_protocol::schema::v1::SessionId;
use agent_runtime_protocol::domain::action::AgentAction;
use agent_runtime_protocol::domain::ports::Transport;
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use bots::domain::models::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde::Deserialize;
use utoipa::ToSchema;

use super::error::Result;
use super::model::*;

/// A bidirectional connection to an agent runtime.
pub trait AgentConnector:
    Transport<ToRuntimeMessage, ToServerMessage> + Send + Sync + 'static
{
}

impl<T> AgentConnector for T where
    T: Transport<ToRuntimeMessage, ToServerMessage> + Send + Sync + 'static
{
}

/// `Send + Sync + 'static` with `Send` futures because callers drive sessions
/// from spawned tasks - a Kafka consumer hands each message to its own task,
/// and a repo whose futures are not `Send` cannot be used there.
#[cfg_attr(feature = "test-utils", mockall::automock)]
pub trait AgentSessionRepo: Send + Sync + 'static {
    /// Atomically persist a new agent session with its dedicated channel and owner participant.
    fn create(
        &self,
        params: CreateAgentSessionParams,
    ) -> impl Future<Output = Result<AgentSession>> + Send;

    /// Get an agent session by id.
    fn get(&self, id: AgentSessionId) -> impl Future<Output = Result<AgentSession>> + Send;

    /// Find the session associated with an incoming channel context.
    ///
    /// ```text
    /// find_for_channel(channel_id, thread_id, bot_id)
    ///     |
    ///     +-- one session owns channel_id and another matches thread_id + bot_id
    ///     |       -> ThreadInDedicatedChannel { both sessions }
    ///     |
    ///     +-- session.channel_id == channel_id
    ///     |       -> InDedicatedChannel
    ///     |
    ///     +-- thread_id and bot_id are Some
    ///     |   and the session matches both
    ///     |       -> CreatedFromThread
    ///     |
    ///     +-- otherwise
    ///             -> None
    /// ```
    fn find_for_channel(
        &self,
        channel_id: Uuid,
        thread_id: Option<Uuid>,
        bot_id: Option<BotId>,
    ) -> impl Future<Output = Result<ChannelSession>> + Send;

    /// The agent behind a session, for rendering the messages it sent.
    ///
    /// A bot that has been deleted still has messages in the channel, so this
    /// answers for one rather than failing - a session's history should not
    /// stop rendering because its agent was removed.
    fn session_bot(&self, id: BotId) -> impl Future<Output = Result<SessionBot>> + Send;

    /// Persist a session's model without replacing other session fields.
    fn set_model(&self, id: AgentSessionId, model: &str)
    -> impl Future<Output = Result<()>> + Send;

    /// Persist the agent-assigned ACP session id without replacing other session fields.
    fn set_acp_session_id(
        &self,
        id: AgentSessionId,
        acp_session_id: SessionId,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Delete an agent session by id.
    fn delete(&self, id: AgentSessionId) -> impl Future<Output = Result<()>> + Send;
}

#[cfg_attr(feature = "test-utils", mockall::automock)]
pub trait AgentSessionLogRepo: Send + Sync + 'static {
    /// Append a log entry and project any system event onto the session status.
    fn create(&self, log: AgentSessionLog) -> impl Future<Output = Result<()>> + Send;

    /// List all log entries for a session, in chronological order.
    ///
    /// Entries come back stamped with when the log recorded them: the frame
    /// itself carries no time, and a reader ordering or merging a session's
    /// messages has nothing else to order them by.
    fn list_by_session(
        &self,
        agent_session_id: AgentSessionId,
    ) -> impl Future<Output = Result<Vec<StoredAgentSessionLog>>> + Send;
}

/// Sequential live log writer owned by one session actor.
pub trait AgentSessionLogWriter: Send + 'static {
    /// Persist and fold one frame into this connection's live projection.
    fn append(&mut self, log: AgentSessionLog) -> impl Future<Output = Result<()>> + Send;
}

/// Pushing a live session's frames to whoever is watching its channel.
///
/// Separate from the durable log: that is what a reader arriving late fetches
/// and folds, while this tells a client already looking at the session what
/// just happened, so it can fold the frame and redraw without refetching.
///
/// Best-effort by contract. A dropped frame costs a viewer some liveness until
/// they reload, and the log it was derived from is already durable - so an
/// implementation may drop, and callers must not fail an append over it.
pub trait AgentSessionRealtime {
    /// Publish one appended frame to the channel's viewers.
    fn publish(
        &self,
        event: LogAppended,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;
}

/// An [`AgentSessionRealtime`] that streams nowhere.
///
/// Dropping every frame is a legal implementation of the port - it is
/// best-effort by contract - so this is what a writer with no viewers to serve
/// gets: `seed_jsonl` replaying a recording into the database, and tests that
/// are asserting on the durable side of an append.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoOpRealtime;

impl AgentSessionRealtime for NoOpRealtime {
    async fn publish(&self, _event: LogAppended) -> Result<(), rootcause::Report> {
        Ok(())
    }
}

/// A control operation a caller may ask for on a live session.
///
/// The transport vocabulary for [`AgentAction`], which it converts into: it
/// names the operations a caller is allowed to ask for, in the shape a request
/// body spells them, and nothing else.
///
/// Not `#[non_exhaustive]`, unlike [`AgentAction`]: a new control operation
/// should fail to compile everywhere that has to decide what it means.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ControlEventKind {
    /// Give the agent something to work on.
    Prompt {
        /// What to tell the agent.
        content: String,
    },
    /// Switch the model the agent runs on.
    ChangeModel {
        /// The model slug to switch to.
        model: String,
    },
    /// Interrupt whatever the agent is doing.
    Stop,
}

impl From<ControlEventKind> for AgentAction {
    fn from(kind: ControlEventKind) -> Self {
        match kind {
            ControlEventKind::Prompt { content } => Self::prompt(content),
            ControlEventKind::ChangeModel { model } => Self::set_model(model),
            ControlEventKind::Stop => Self::Stop,
        }
    }
}

/// One control operation, and who is responsible for it.
#[derive(Debug, Clone)]
pub struct ControlEvent {
    /// What was asked for.
    pub kind: ControlEventKind,
    /// The user responsible, absent when a bot acted on nobody's behalf.
    ///
    /// `None` means "no user is responsible", not "unknown" - a bot's own
    /// actions are attributed to the bot, which this field does not carry.
    pub actor: Option<MacroUserIdStr<'static>>,
}

/// Whoever holds a session's live resources, told when the durable session
/// changes in a way those resources have to follow.
///
/// In-process today: a session's actor and its container live in one address
/// space, so only the process that opened the session can act on this. The
/// port exists so that coupling is named rather than assumed, and so the
/// control routes can be mounted against it without knowing what a harness is.
#[cfg_attr(feature = "test-utils", mockall::automock)]
pub trait AgentSessionNotificationRecipient: Send + Sync + 'static {
    /// The session is going away: release its live resources and delete it.
    fn session_deleted(&self, id: AgentSessionId) -> impl Future<Output = Result<()>> + Send;

    /// A control operation the live connection has to be told about.
    fn control_event(
        &self,
        id: AgentSessionId,
        event: ControlEvent,
    ) -> impl Future<Output = Result<()>> + Send;
}
