//! In-memory session log test double.

use std::sync::{Arc, Mutex};

use agent_session::domain::error::Result;
use agent_session::domain::model::{AgentSessionId, AgentSessionLog};
use agent_session::domain::ports::AgentSessionLogRepo;

/// The session log, kept in memory. Cloning shares one log.
#[derive(Clone, Default)]
pub struct LogRepoMock {
    entries: Arc<Mutex<Vec<AgentSessionLog>>>,
}

impl LogRepoMock {
    /// Create an empty log.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Every entry appended, in order.
    #[must_use]
    pub fn entries(&self) -> Vec<AgentSessionLog> {
        self.lock().clone()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<AgentSessionLog>> {
        self.entries
            .lock()
            .expect("log mock lock should not be poisoned")
    }
}

impl AgentSessionLogRepo for LogRepoMock {
    async fn create(&self, log: AgentSessionLog) -> Result<()> {
        self.lock().push(log);
        Ok(())
    }

    async fn list_by_session(
        &self,
        agent_session_id: AgentSessionId,
    ) -> Result<Vec<AgentSessionLog>> {
        Ok(self
            .lock()
            .iter()
            .filter(|entry| entry.agent_session_id == agent_session_id)
            .cloned()
            .collect())
    }
}
