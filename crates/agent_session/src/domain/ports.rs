use bots::domain::models::BotId;
use macro_uuid::Uuid;

use super::error::Result;
use super::model::*;

/// `Send + Sync + 'static` with `Send` futures because callers drive sessions
/// from spawned tasks - a Kafka consumer hands each message to its own task,
/// and a repo whose futures are not `Send` cannot be used there.
#[cfg_attr(feature = "test-utils", mockall::automock)]
pub trait AgentSessionRepo: Send + Sync + 'static {
    /// Persist a new agent session. The caller mints the id (see
    /// [`AgentSessionId::new`]), so it can be referenced - e.g. by the channel
    /// message rooting the session's thread - before the row exists.
    fn create(&self, session: AgentSession) -> impl Future<Output = Result<()>> + Send;

    /// Get an agent session by id.
    fn get(&self, id: AgentSessionId) -> impl Future<Output = Result<AgentSession>> + Send;

    /// Every bot's session state for the thread a channel message arrived in.
    ///
    /// One query rather than one per bot: the caller cannot know which bots to
    /// ask about, because a message in a session's own thread names no bot at
    /// all. Bots without a session in this thread simply do not appear; the
    /// returned [`ThreadSession`] is never [`ThreadSession::None`].
    fn find_all_for_thread(
        &self,
        thread_id: Uuid,
    ) -> impl Future<Output = Result<Vec<(BotId, ThreadSession)>>> + Send;

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
