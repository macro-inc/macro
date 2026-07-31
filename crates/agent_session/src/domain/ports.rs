use super::error::Result;
use super::model::*;

pub trait AgentSessionRepo {
    /// Create a new agent session, returning its id.
    fn create(
        &self,
        session: AgentSession<UninitializedSession>,
    ) -> impl Future<Output = Result<AgentSessionId>>;

    /// Get an agent session by id.
    fn get(&self, id: AgentSessionId)
    -> impl Future<Output = Result<AgentSession<AgentSessionId>>>;

    /// Update an existing agent session.
    fn update(&self, session: AgentSession<AgentSessionId>) -> impl Future<Output = Result<()>>;

    /// Delete an agent session by id.
    fn delete(&self, id: AgentSessionId) -> impl Future<Output = Result<()>>;
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
