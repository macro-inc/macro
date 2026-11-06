//! Agent secret service implementation.

use entity_access::domain::models::{AdminTeamRole, EntityAccessReceipt};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::admin::AgentAdminRollout;
use super::models::{
    AgentSecret, AgentSecretError, AgentSecretSummaries, AgentSecretSummary, SecretName,
    SecretValue,
};
use super::ports::{AgentSecretRepository, AgentSecretService, SecretCipher, TeamAgentDirectory};

#[cfg(test)]
mod test;

/// Agent secret service backed by its ports.
pub struct AgentSecretServiceImpl<Repository, Cipher, Directory, Rollout> {
    repository: Repository,
    cipher: Cipher,
    directory: Directory,
    rollout: Rollout,
}

impl<Repository, Cipher, Directory, Rollout>
    AgentSecretServiceImpl<Repository, Cipher, Directory, Rollout>
{
    /// Builds the service.
    pub fn new(
        repository: Repository,
        cipher: Cipher,
        directory: Directory,
        rollout: Rollout,
    ) -> Self {
        Self {
            repository,
            cipher,
            directory,
            rollout,
        }
    }
}

impl<Repository, Cipher, Directory, Rollout>
    AgentSecretServiceImpl<Repository, Cipher, Directory, Rollout>
where
    Directory: TeamAgentDirectory,
    Rollout: AgentAdminRollout,
{
    /// Only team agents keep secrets.
    async fn ensure_agent(&self, caller: &MacroUserIdStr<'_>) -> Result<(), AgentSecretError> {
        self.directory
            .team_of(caller)
            .await?
            .map(|_| ())
            .ok_or(AgentSecretError::NotAnAgent)
    }

    async fn ensure_admin_enabled(
        &self,
        receipt: &EntityAccessReceipt<AdminTeamRole>,
    ) -> Result<(), AgentSecretError> {
        let caller = receipt
            .acting_user_id()
            .ok_or(AgentSecretError::NotEnabled)?;
        if self.rollout.enabled(caller).await {
            Ok(())
        } else {
            Err(AgentSecretError::NotEnabled)
        }
    }

    /// Admins reach only their own team's agents.
    async fn ensure_on_team(
        &self,
        receipt: &EntityAccessReceipt<AdminTeamRole>,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<(), AgentSecretError> {
        let team_id = Uuid::parse_str(&receipt.entity().entity_id)
            .map_err(|_| AgentSecretError::BadRequest("the caller has no team".to_string()))?;

        match self.directory.team_of(agent_user_id).await? {
            Some(agent_team_id) if agent_team_id == team_id => Ok(()),
            _ => Err(AgentSecretError::NotFound),
        }
    }
}

impl<Repository, Cipher, Directory, Rollout> AgentSecretService
    for AgentSecretServiceImpl<Repository, Cipher, Directory, Rollout>
where
    Repository: AgentSecretRepository,
    Cipher: SecretCipher,
    Directory: TeamAgentDirectory,
    Rollout: AgentAdminRollout,
{
    #[tracing::instrument(skip(self, value), err)]
    async fn put(
        &self,
        caller: &MacroUserIdStr<'_>,
        name: &str,
        value: String,
    ) -> Result<AgentSecretSummary, AgentSecretError> {
        let name = SecretName::parse(name)?;
        let value = SecretValue::parse(value)?;
        self.ensure_agent(caller).await?;

        let encrypted = self.cipher.encrypt(caller, &name, &value).await?;
        self.repository.upsert(caller, &name, &encrypted).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn get(
        &self,
        caller: &MacroUserIdStr<'_>,
        name: &str,
    ) -> Result<AgentSecret, AgentSecretError> {
        let name = SecretName::parse(name)?;
        self.ensure_agent(caller).await?;

        let stored = self
            .repository
            .get(caller, &name)
            .await?
            .ok_or(AgentSecretError::NotFound)?;
        let value = self
            .cipher
            .decrypt(caller, &name, &stored.encrypted)
            .await?;

        Ok(AgentSecret {
            name: stored.name,
            value,
            updated_at: stored.updated_at,
        })
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete(
        &self,
        caller: &MacroUserIdStr<'_>,
        name: &str,
    ) -> Result<(), AgentSecretError> {
        let name = SecretName::parse(name)?;
        self.ensure_agent(caller).await?;

        self.repository.delete(caller, &name).await?;
        Ok(())
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn list_for_admin(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<AgentSecretSummaries, AgentSecretError> {
        self.ensure_admin_enabled(&receipt).await?;
        self.ensure_on_team(&receipt, agent_user_id).await?;

        let secrets = self.repository.list(agent_user_id).await?;
        Ok(AgentSecretSummaries { secrets })
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn delete_for_admin(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent_user_id: &MacroUserIdStr<'_>,
        name: &str,
    ) -> Result<(), AgentSecretError> {
        self.ensure_admin_enabled(&receipt).await?;
        let name = SecretName::parse(name)?;
        self.ensure_on_team(&receipt, agent_user_id).await?;

        self.repository.delete(agent_user_id, &name).await?;
        Ok(())
    }
}
