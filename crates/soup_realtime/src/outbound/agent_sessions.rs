//! Resolve PR dependencies through the agent-session domain's existing link port.
use crate::domain::ports::PullRequestSessions;
use agent_session::domain::pull_request_links::SessionPullRequestLinkRepo;
use model_entity::{Entity, EntityType};
use rootcause::prelude::{Report, ResultExt as _};

/// Uses the owning session repository to look up links without duplicating its SQL.
pub struct AgentSessionPullRequestLookup<R>(pub R);
impl<R: SessionPullRequestLinkRepo> PullRequestSessions for AgentSessionPullRequestLookup<R> {
    async fn linked_sessions(&self, github_key: &str) -> Result<Vec<Entity<'static>>, Report> {
        Ok(self
            .0
            .sessions_for_pull_request(github_key)
            .await
            .context("finding sessions linked to PR")?
            .into_iter()
            .map(|id| EntityType::AgentSession.with_entity_string(id.to_string()))
            .collect())
    }
}
