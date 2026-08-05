use bots::domain::models::BotId;
use macro_uuid::Uuid;

use super::error::Result;
use super::model::*;

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

    /// Delete an agent session by id.
    fn delete(&self, id: AgentSessionId) -> impl Future<Output = Result<()>> + Send;
}

pub trait AgentSessionLogRepo {
    /// Append a new log entry to a session's history.
    fn create(&self, log: AgentSessionLog) -> impl Future<Output = Result<()>>;

    /// List all log entries for a session, in chronological order.
    fn list_by_session(
        &self,
        agent_session_id: AgentSessionId,
    ) -> impl Future<Output = Result<Vec<AgentSessionLog>>>;
}
