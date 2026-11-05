//! Workspace repos through `agent_git_service`'s internal API.

use agent_git::client::{AgentGitClient, AgentGitClientError};
use agent_git::domain::template::PersonaSeed as RepoSeed;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::models::{AgentRepo, Credential, PersonaSeed, TeamAgentError};
use crate::domain::ports::AgentRepos;

/// Creates and deletes agents' repos with the agent git client.
pub struct AgentGitRepos {
    client: AgentGitClient,
    clone_base_url: String,
}

impl AgentGitRepos {
    /// Wraps the agent git client.
    pub fn new(client: AgentGitClient, clone_base_url: String) -> Self {
        Self {
            client,
            clone_base_url,
        }
    }
}

impl AgentRepos for AgentGitRepos {
    #[tracing::instrument(name = "team_agents.repo.create", skip_all, err)]
    async fn create(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        team_id: Uuid,
        seed: &PersonaSeed,
    ) -> Result<AgentRepo, TeamAgentError> {
        // The internal create endpoint's address need not be reachable from a
        // computer. Build its advertised remote before creating any resources.
        let mut clone_url =
            reqwest::Url::parse(&self.clone_base_url).map_err(TeamAgentError::internal)?;
        clone_url
            .path_segments_mut()
            .map_err(|_| {
                TeamAgentError::internal_message("the computer git URL is not a base URL")
            })?
            .pop_if_empty()
            .push(&format!("{}.git", agent_user_id.as_ref()));
        let created = self
            .client
            .create_repo(
                agent_user_id.clone().into_owned(),
                team_id,
                RepoSeed {
                    creator_id: seed.creator_id.clone(),
                    name: seed.name.clone(),
                    job_description: seed.job_description.clone(),
                    personality: seed.personality.clone(),
                },
            )
            .await
            .map_err(|error| {
                tracing::error!(error = ?error, "workspace repository creation failed before purchase");
                let reason = match &error {
                    AgentGitClientError::Status { body, .. }
                        if body.contains("run git init") && body.contains("No such file or directory") =>
                    {
                        "The workspace repository service is missing git. Nothing was charged."
                    }
                    _ => "The workspace repository could not be created. Nothing was charged.",
                };
                TeamAgentError::InvitationFailed(reason.to_string())
            })?;

        Ok(AgentRepo {
            url: clone_url.to_string(),
            token: Credential::new(created.token),
        })
    }

    #[tracing::instrument(name = "team_agents.repo.ensure", skip_all, fields(agent_user_id = %macro_user_id::telemetry_id(agent_user_id.as_ref()), %team_id), err)]
    async fn ensure(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        team_id: Uuid,
        seed: &PersonaSeed,
        token: &Credential,
    ) -> Result<(), TeamAgentError> {
        self.client
            .ensure_repo(
                agent_user_id.clone().into_owned(),
                team_id,
                RepoSeed {
                    creator_id: seed.creator_id.clone(),
                    name: seed.name.clone(),
                    job_description: seed.job_description.clone(),
                    personality: seed.personality.clone(),
                },
                token.expose(),
            )
            .await
            .map_err(|error| {
                TeamAgentError::RepoProvider(rootcause::Report::new(error).into_dynamic())
            })?;
        Ok(())
    }

    #[tracing::instrument(name = "team_agents.repo.delete", skip_all, err)]
    async fn delete(&self, agent_user_id: &MacroUserIdStr<'_>) -> Result<(), TeamAgentError> {
        self.client
            .delete_repo(agent_user_id)
            .await
            .map_err(|error| {
                TeamAgentError::RepoProvider(rootcause::Report::new(error).into_dynamic())
            })
    }
}

#[cfg(test)]
mod test;
