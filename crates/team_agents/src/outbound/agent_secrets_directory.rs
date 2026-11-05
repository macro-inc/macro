//! Tells `agent_secrets` which accounts are team agents, from the
//! `team_agents` rows this crate owns.

use agent_secrets::domain::models::AgentSecretError;
use agent_secrets::domain::ports::TeamAgentDirectory;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::ports::TeamAgentRepository;

/// [`TeamAgentDirectory`] over the team agents repository.
pub struct TeamAgentsDirectory<Repository> {
    repository: Repository,
}

impl<Repository> TeamAgentsDirectory<Repository> {
    /// Reads agents from `repository`.
    pub fn new(repository: Repository) -> Self {
        Self { repository }
    }
}

impl<Repository: TeamAgentRepository> TeamAgentDirectory for TeamAgentsDirectory<Repository> {
    async fn team_of(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<Uuid>, AgentSecretError> {
        let agent = self
            .repository
            .get(agent_user_id)
            .await
            .map_err(AgentSecretError::internal)?;

        Ok(agent.map(|agent| agent.team_id))
    }
}
