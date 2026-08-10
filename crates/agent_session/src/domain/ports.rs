use agent_client_protocol::schema::v1::SessionId;
use agent_runtime_protocol::domain::ports::Transport;
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use bots::domain::models::BotId;
use macro_uuid::Uuid;

use super::error::Result;
use super::model::*;
use std::collections::HashSet;

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

    /// Update an existing agent session.
    fn update(&self, session: AgentSession) -> impl Future<Output = Result<()>> + Send;

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
    fn list_by_session(
        &self,
        agent_session_id: AgentSessionId,
    ) -> impl Future<Output = Result<Vec<AgentSessionLog>>> + Send;
}

/// Writing agent-message placeholder rows into comms.
///
/// A placeholder is a comms message with no stored body whose
/// `agent_session_message_id` - the composite
/// `"{agent_session_id}:{turn}:{author}"` - names the folded message of an
/// agent session it renders. The service diffs
/// [`Comms::messages_with_placeholders`] against what the fold derives
/// ([`FoldedMessageRepo::message_ids`](agent_fold::domain::ports::FoldedMessageRepo::message_ids))
/// to decide which placeholders are missing.
///
/// One placeholder per folded message, not per turn: a turn's prompt and its
/// reply have different authors, so collapsing them onto one row would leave
/// the prompt with no sender of its own.
pub trait Comms {
    /// The messages of this session that already have a placeholder row in
    /// its channel.
    fn messages_with_placeholders(
        &self,
        session: &AgentSession,
    ) -> impl Future<Output = Result<HashSet<MessageId>, rootcause::Report>> + Send;

    /// Write a bodyless placeholder row to the session's channel, carrying
    /// the given message key inside its `agent_session_message_id`.
    ///
    /// `author` sets the row's sender: the agent's messages are sent by the
    /// session's bot, a user's by that user.
    fn create_message_placeholder(
        &self,
        session: &AgentSession,
        id: MessageId,
        author: &Author,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;
}
