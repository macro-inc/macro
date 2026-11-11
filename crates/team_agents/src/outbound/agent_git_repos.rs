//! Workspace repositories through agent_git_service's internal API.

use std::sync::Arc;

use agent_git::client::AgentGitClient;
use agent_git::domain::template::PersonaSeed as RepoSeed;
use macro_service_urls::AgentGitServiceUrl;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::models::{AgentRepo, PersonaSeed, TeamAgentError};
use crate::domain::ports::AgentRepos;

#[cfg(test)]
mod test;

/// Where computers clone from; not necessarily the internal API's address.
type CloneBaseUrl = dyn Fn() -> Result<AgentGitServiceUrl, TeamAgentError> + Send + Sync;

/// Creates and deletes agents' repositories with the agent git client.
pub struct AgentGitRepos {
    client: AgentGitClient,
    clone_base_url: Arc<CloneBaseUrl>,
}

impl AgentGitRepos {
    /// Wrap the agent git client; computers clone from [`AgentGitServiceUrl`].
    pub fn new(client: AgentGitClient) -> Self {
        Self {
            client,
            clone_base_url: Arc::new(|| {
                AgentGitServiceUrl::new().map_err(TeamAgentError::internal)
            }),
        }
    }

    fn clone_url(&self, agent: &MacroUserIdStr<'_>) -> Result<String, TeamAgentError> {
        clone_url(&(self.clone_base_url)()?, agent)
    }
}

fn repo_seed(seed: &PersonaSeed) -> RepoSeed {
    RepoSeed {
        creator_id: seed.creator_id.clone(),
        name: seed.name.clone(),
        job_description: seed.job_description.clone(),
        personality: seed.personality.clone(),
    }
}

/// `<base>/<agent user id>.git`. The base must be an HTTP(S) URL a computer
/// can reach, without credentials, query or fragment.
fn clone_url(
    base: &AgentGitServiceUrl,
    agent: &MacroUserIdStr<'_>,
) -> Result<String, TeamAgentError> {
    let mut url = base.parse_url().map_err(TeamAgentError::internal)?;
    let host = url
        .host_str()
        .ok_or(TeamAgentError::Internal(rootcause::report!(
            "the computer git URL needs a host"
        )))?;
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host.ends_with(".localhost")
        || host
            .trim_matches(['[', ']'])
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback() || ip.is_unspecified());
    if !matches!(url.scheme(), "http" | "https")
        || loopback
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(TeamAgentError::Internal(rootcause::report!(
            "the computer git URL must be a reachable HTTP(S) base without credentials, query or fragment"
        )));
    }
    url.path_segments_mut()
        .map_err(|()| {
            TeamAgentError::Internal(rootcause::report!("the computer git URL is not a base URL"))
        })?
        .pop_if_empty()
        .push(&format!("{}.git", agent.as_ref()));
    Ok(url.to_string())
}

impl AgentRepos for AgentGitRepos {
    #[tracing::instrument(name = "team_agents.repo.create", skip_all, err)]
    async fn create(
        &self,
        agent: &MacroUserIdStr<'_>,
        team_id: Uuid,
        seed: &PersonaSeed,
    ) -> Result<AgentRepo, TeamAgentError> {
        // Check the advertised remote before creating anything.
        let url = self.clone_url(agent)?;
        let created = self
            .client
            .create_repo(agent.clone().into_owned(), team_id, repo_seed(seed))
            .await
            .map_err(|error| {
                TeamAgentError::RepoUnavailable(rootcause::Report::new(error).into_dynamic())
            })?;
        Ok(AgentRepo {
            url,
            token: created.token,
        })
    }

    #[tracing::instrument(name = "team_agents.repo.delete", skip_all, err)]
    async fn delete(&self, agent: &MacroUserIdStr<'_>) -> Result<(), TeamAgentError> {
        self.client.delete_repo(agent).await.map_err(|error| {
            TeamAgentError::RepoUnavailable(rootcause::Report::new(error).into_dynamic())
        })
    }
}
