//! Taking a team's agents off their owners' own machines before the team
//! is deleted.

use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::self_hosted::revoke_credentials;
use crate::domain::models::TeamAgentError;
use crate::domain::ports::{
    AgentApiKeys, AgentRepos, TeamAgentRepository, TeammateInstalls, TeammateRuntimes,
};

/// Releases a team's own-machine installs ahead of its deletion. Needs only
/// storage, keys, repositories and delivery nudges, so team deletion can
/// hold it without the agent service, which is built on the team service.
pub struct TeamInstallRelease<Repository, ApiKeys, Repos, Installs, Runtimes> {
    repository: Repository,
    api_keys: ApiKeys,
    repos: Repos,
    installs: Installs,
    runtimes: Runtimes,
}

impl<Repository, ApiKeys, Repos, Installs, Runtimes>
    TeamInstallRelease<Repository, ApiKeys, Repos, Installs, Runtimes>
where
    Repository: TeamAgentRepository,
    ApiKeys: AgentApiKeys,
    Repos: AgentRepos,
    Installs: TeammateInstalls,
    Runtimes: TeammateRuntimes,
{
    /// Build it on its ports.
    pub fn new(
        repository: Repository,
        api_keys: ApiKeys,
        repos: Repos,
        installs: Installs,
        runtimes: Runtimes,
    ) -> Self {
        Self {
            repository,
            api_keys,
            repos,
            installs,
            runtimes,
        }
    }

    /// Take every agent of `team_id` off its machine: park it (waiting for a
    /// delivery in flight), revoke its credentials, delete its install, and
    /// tell the machine, which stops it as no longer its own. The install
    /// goes last, so a failure leaves it for the next attempt; the team row
    /// can't be deleted while one is left. Safe to repeat.
    #[tracing::instrument(name = "team_agents.release_team_installs", skip(self), fields(installs = tracing::field::Empty), err)]
    pub async fn release_team(&self, team_id: Uuid) -> Result<(), TeamAgentError> {
        let installs = self.installs.of_team(team_id).await?;
        tracing::Span::current().record("installs", installs.len());
        for install in installs {
            self.release(&install.agent).await?;
            self.runtimes.installs_changed(install.harness_id).await;
            tracing::info!(install_id = %install.install_id, "took a deleted team's agent teammate off its machine");
        }
        Ok(())
    }

    async fn release(&self, agent: &MacroUserIdStr<'_>) -> Result<(), TeamAgentError> {
        // `None` while it is being removed; it is deleted below either way.
        self.installs.park(agent).await?;
        revoke_credentials(&self.repository, &self.api_keys, &self.repos, agent).await?;
        self.installs.delete(agent).await
    }
}
