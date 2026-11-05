//! Workspace repos through `agent_git_service`'s internal API.

use agent_git::client::AgentGitClient;
use agent_git::domain::template::PersonaSeed as RepoSeed;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::models::{AgentRepo, Credential, PersonaSeed, TeamAgentError};
use crate::domain::ports::AgentRepos;

/// Creates and deletes agents' repos with the agent git client.
pub struct AgentGitRepos {
    client: AgentGitClient,
}

impl AgentGitRepos {
    /// Wraps the agent git client.
    pub fn new(client: AgentGitClient) -> Self {
        Self { client }
    }
}

impl AgentRepos for AgentGitRepos {
    #[tracing::instrument(name = "team_agents.repo.create", skip(self, seed), err)]
    async fn create(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        team_id: Uuid,
        seed: &PersonaSeed,
    ) -> Result<AgentRepo, TeamAgentError> {
        let created = self
            .client
            .create_repo(
                agent_user_id.clone().into_owned(),
                team_id,
                RepoSeed {
                    name: seed.name.clone(),
                    job_description: seed.job_description.clone(),
                    personality: seed.personality.clone(),
                },
            )
            .await
            .map_err(TeamAgentError::internal)?;

        Ok(AgentRepo {
            url: created.clone_url,
            token: Credential::new(created.token),
        })
    }

    #[tracing::instrument(name = "team_agents.repo.delete", skip(self), err)]
    async fn delete(&self, agent_user_id: &MacroUserIdStr<'_>) -> Result<(), TeamAgentError> {
        self.client
            .delete_repo(agent_user_id)
            .await
            .map_err(TeamAgentError::internal)
    }
}
