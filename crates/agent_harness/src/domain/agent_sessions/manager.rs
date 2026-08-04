use agent_session::domain::model::{
    AgentSession as AgentSessionRecord, AgentSessionId, NewAgentSession,
};
use agent_session::domain::ports::{AgentSessionLogRepo, AgentSessionRepo};

use crate::domain::agent_sessions::session::AgentSession;
use crate::domain::connector::AgentConnector;
use crate::domain::error::Result;

/// Mints agent sessions and wires them to a link.
///
/// Knows nothing about containers: a session's row has to exist before anything
/// can be provisioned for it, since the link is named after the session. So
/// whoever provisions calls [`Self::create`], sets up a link for `record.id`,
/// then hands it to [`Self::attach`].
pub struct AgentSessionManager<Sessions, Logs> {
    sessions: Sessions,
    logs: Logs,
}

impl<Sessions, Logs> AgentSessionManager<Sessions, Logs>
where
    Sessions: AgentSessionRepo,
    Logs: AgentSessionLogRepo + Clone,
{
    pub fn new(sessions: Sessions, logs: Logs) -> Self {
        Self { sessions, logs }
    }

    /// Mint a new session's row and its own thread.
    pub async fn create(&self, new: NewAgentSession) -> Result<AgentSessionRecord> {
        Ok(self.sessions.create(new).await?)
    }

    /// Read an existing session's row, to reattach to it.
    pub async fn get(&self, id: AgentSessionId) -> Result<AgentSessionRecord> {
        Ok(self.sessions.get(id).await?)
    }

    /// Wire a link to a session, giving it the log it persists through.
    pub fn plug<Connector>(
        &self,
        id: AgentSessionId,
        connector: Connector,
    ) -> AgentSession<Connector, Logs>
    where
        Connector: AgentConnector,
    {
        AgentSession::new(id, connector, self.logs.clone())
    }
}
